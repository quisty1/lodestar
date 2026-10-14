import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import {
  runtimeError,
  runtimeOk,
  type RuntimeErrorCode,
  type StartAutopilotRequest,
  type StartAutopilotResponse,
  type StopAutopilotRequest,
  type StopAutopilotResponse,
} from '@lib/runtimeProtocol';
import type { AutopilotStatus, LodestarMessage, RunReport } from '@lib/types';
import type { AutopilotRuntimeClient } from '../lib/runtimeClient';
import { runtimeFailureHint, useAutopilot, type UseAutopilot } from './useAutopilot';

const stopped: AutopilotStatus = { running: false, used: 0, ceiling: 30, revision: 1 };
const running: AutopilotStatus = {
  running: true,
  used: 2,
  ceiling: 30,
  revision: 2,
  runId: 'run-1',
  phase: 'feed_loop',
  stage: 'Листаю ленту',
};

function deferred<T>() {
  let resolve!: (value?: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done as (value?: T) => void;
  });
  return { promise, resolve };
}

function runtime(overrides: Partial<AutopilotRuntimeClient> = {}): AutopilotRuntimeClient {
  return {
    status: vi.fn(async () => runtimeOk(stopped)),
    start: vi.fn(async (_request: StartAutopilotRequest): Promise<StartAutopilotResponse> =>
      runtimeOk({
        started: true as const,
        duplicate: false,
        runId: 'run-1',
        status: { ...running, runId: 'run-1' },
      }),
    ),
    stop: vi.fn(async (request: StopAutopilotRequest): Promise<StopAutopilotResponse> =>
      runtimeOk({
        stopped: true,
        runId: request.runId,
        status: {
          ...stopped,
          revision: 3,
          runId: request.runId,
          phase: 'finished' as const,
          stopReason: 'manual' as const,
        },
      }),
    ),
    ...overrides,
  };
}

let listener: ((message: LodestarMessage) => void) | undefined;
let wrappers: VueWrapper[];

beforeEach(() => {
  listener = undefined;
  wrappers = [];
  (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
    runtime: {
      id: 'test-extension',
      sendMessage: vi.fn(async (message: LodestarMessage) =>
        message.type === 'LIST_REPORTS' ? [] : undefined,
      ),
      onMessage: {
        addListener: vi.fn((next: (message: LodestarMessage) => void) => {
          listener = next;
        }),
        removeListener: vi.fn(),
      },
    },
  } as unknown as typeof chrome;
});

afterEach(() => {
  wrappers.forEach((wrapper) => {
    wrapper.unmount();
  });
  Reflect.deleteProperty(globalThis, 'chrome');
});

async function mounted(
  client: AutopilotRuntimeClient,
  options: { beforeStart?: () => Promise<void>; createRequestId?: () => string } = {},
): Promise<UseAutopilot> {
  let composable!: UseAutopilot;
  const Harness = defineComponent({
    setup() {
      composable = useAutopilot({ client, ...options });
      return () => h('div');
    },
  });
  const wrapper = mount(Harness);
  wrappers.push(wrapper);
  await flushPromises();
  return composable;
}

describe('useAutopilot mounted lifecycle', () => {
  it('hydrates a reopened panel with the running status', async () => {
    const ap = await mounted(runtime({ status: vi.fn(async () => runtimeOk(running)) }));

    expect(ap.status.value).toEqual(running);
    expect(ap.stage.value).toBe('Листаю ленту');
  });

  it('keeps a newer broadcast when an older hydration response arrives later', async () => {
    const hydration = deferred<ReturnType<typeof runtimeOk<AutopilotStatus>>>();
    const client = runtime({ status: vi.fn(() => hydration.promise) });
    const mountPromise = mounted(client);
    await Promise.resolve();
    const newer = { ...running, runId: 'run-new', stage: 'Добавляю в сеть' };

    listener?.({ type: 'AUTOPILOT_STATUS', status: newer });
    hydration.resolve(runtimeOk(stopped));
    const ap = await mountPromise;

    expect(ap.status.value).toEqual(newer);
    expect(ap.stage.value).toBe('Добавляю в сеть');
  });

  it('keeps the newest hydration when two status requests resolve out of order', async () => {
    const oldHydration = deferred<ReturnType<typeof runtimeOk<AutopilotStatus>>>();
    const status = vi
      .fn()
      .mockImplementationOnce(() => oldHydration.promise)
      .mockResolvedValueOnce(runtimeOk(running));
    const ap = await mounted(runtime({ status }));

    await ap.hydrateStatus();
    oldHydration.resolve(runtimeOk(stopped));
    await flushPromises();

    expect(ap.status.value).toEqual(running);
  });

  it('ignores a stage from an old run and clears the current stage when stopped', async () => {
    const ap = await mounted(runtime({ status: vi.fn(async () => runtimeOk(running)) }));

    listener?.({ type: 'AUTOPILOT_STAGE', runId: 'old-run', label: 'Старый шаг' });
    expect(ap.stage.value).toBe('Листаю ленту');
    listener?.({ type: 'AUTOPILOT_STAGE', runId: 'run-1', label: 'Публикую пост' });
    expect(ap.stage.value).toBe('Публикую пост');
    listener?.({
      type: 'AUTOPILOT_STATUS',
      status: { ...stopped, revision: 3, runId: 'run-1', phase: 'finished', stopReason: 'manual' },
    });
    expect(ap.stage.value).toBeNull();
    expect(ap.startHint.value).toBeNull();
  });

  it('shows why a running launch stopped when START itself succeeded', async () => {
    const ap = await mounted(runtime({ status: vi.fn(async () => runtimeOk(running)) }));

    listener?.({
      type: 'AUTOPILOT_STATUS',
      status: {
        ...stopped,
        revision: 3,
        runId: 'run-1',
        phase: 'finished',
        stopReason: 'unsupported_dom',
      },
    });

    expect(ap.status.value?.running).toBe(false);
    expect(ap.startHint.value).toMatch(/размет/i);
  });

  it('keeps LIST_REPORTS compatibility and does not crash mount on transport errors', async () => {
    const report: RunReport = {
      id: 'report-1',
      startedAt: '2026-08-11T10:00:00.000Z',
      endedAt: '2026-08-11T10:01:00.000Z',
      host: 'tab',
      stopReason: 'completed',
      modules: [],
    };
    const send = vi.mocked(chrome.runtime.sendMessage);
    send.mockImplementation(async (message: unknown) => {
      if ((message as { type?: string }).type === 'LIST_REPORTS') return [report];
      throw new Error('not reachable');
    });
    const ap = await mounted(
      runtime({ status: vi.fn(async () => runtimeError('transport-error', 'offline', true)) }),
    );

    expect(ap.reports.value).toEqual([report]);
    expect(ap.status.value).toBeNull();

    send.mockRejectedValueOnce(new Error('worker slept'));
    listener?.({ type: 'AUTOPILOT_REPORT', report });
    await flushPromises();
    expect(ap.reports.value).toEqual([]);
  });
});

describe('useAutopilot operations', () => {
  it('applies the final START response after an intermediate starting broadcast', async () => {
    const completion = deferred<StartAutopilotResponse>();
    const client = runtime({ start: vi.fn(() => completion.promise) });
    const ap = await mounted(client);

    const startPromise = ap.start();
    await Promise.resolve();
    listener?.({
      type: 'AUTOPILOT_STATUS',
      status: { ...running, revision: 2, phase: 'starting', stage: 'Подготавливаю запуск' },
    });
    completion.resolve(
      runtimeOk({
        started: true,
        duplicate: false,
        runId: 'run-1',
        status: { ...running, revision: 3, phase: 'feed_loop', stage: 'Листаю ленту' },
      }),
    );
    await startPromise;

    expect(ap.status.value).toMatchObject({ revision: 3, phase: 'feed_loop' });
    expect(ap.stage.value).toBe('Листаю ленту');
  });

  it('applies the final STOP response after an intermediate stopping broadcast', async () => {
    const completion = deferred<StopAutopilotResponse>();
    const client = runtime({
      status: vi.fn(async () => runtimeOk(running)),
      stop: vi.fn(() => completion.promise),
    });
    const ap = await mounted(client);

    const stopPromise = ap.stop();
    await Promise.resolve();
    listener?.({
      type: 'AUTOPILOT_STATUS',
      status: { ...running, running: false, revision: 3, phase: 'stopping', stage: undefined },
    });
    completion.resolve(
      runtimeOk({
        stopped: true,
        runId: 'run-1',
        status: {
          ...stopped,
          revision: 4,
          runId: 'run-1',
          phase: 'finished',
          stopReason: 'manual',
        },
      }),
    );
    await stopPromise;

    expect(ap.status.value).toMatchObject({ revision: 4, phase: 'finished', stopReason: 'manual' });
    expect(ap.stage.value).toBeNull();
  });

  it('does not let a stale START response replace a newer run', async () => {
    const completion = deferred<StartAutopilotResponse>();
    const client = runtime({ start: vi.fn(() => completion.promise) });
    const ap = await mounted(client);

    const startPromise = ap.start();
    await Promise.resolve();
    const newer = { ...running, revision: 3, runId: 'run-new', stage: 'Новый запуск' };
    listener?.({ type: 'AUTOPILOT_STATUS', status: newer });
    completion.resolve(
      runtimeOk({
        started: true,
        duplicate: false,
        runId: 'run-old',
        status: { ...running, revision: 2, runId: 'run-old', stage: 'Старый запуск' },
      }),
    );
    await startPromise;

    expect(ap.status.value).toEqual(newer);
    expect(ap.stage.value).toBe('Новый запуск');
  });

  it('marks START pending before storage preflight and sends one stable requestId', async () => {
    const preflight = deferred<undefined>();
    const client = runtime();
    const ap = await mounted(client, {
      beforeStart: () => preflight.promise,
      createRequestId: () => 'request-stable',
    });

    const startPromise = ap.start();
    expect(ap.pending.value).toBe('starting');
    expect(client.start).not.toHaveBeenCalled();

    preflight.resolve();
    await startPromise;
    expect(client.start).toHaveBeenCalledWith({
      type: 'START_AUTOPILOT',
      host: 'tab',
      requestId: 'request-stable',
    });
    expect(ap.status.value).toMatchObject({ running: true, runId: 'run-1' });
    expect(ap.pending.value).toBeNull();
  });

  it('surfaces a storage preflight rejection and always re-enables controls', async () => {
    const client = runtime();
    const ap = await mounted(client, {
      beforeStart: async () => {
        throw new Error('storage failed');
      },
    });

    await ap.start();

    expect(client.start).not.toHaveBeenCalled();
    expect(ap.startHint.value).toMatch(/настройки модулей/i);
    expect(ap.pending.value).toBeNull();
  });

  it('surfaces exhausted runtime transport and always re-enables controls', async () => {
    const client = runtime({
      start: vi.fn(async () => runtimeError('transport-error', 'worker unavailable', true)),
    });
    const ap = await mounted(client);

    await ap.start();

    expect(ap.startHint.value).toMatch(/фоновый процесс/i);
    expect(ap.pending.value).toBeNull();
  });

  it('settles START even if request id creation fails', async () => {
    const ap = await mounted(runtime(), {
      createRequestId: () => {
        throw new Error('crypto unavailable');
      },
    });

    await expect(ap.start()).resolves.toBeUndefined();
    expect(ap.startHint.value).toMatch(/фоновый процесс/i);
    expect(ap.pending.value).toBeNull();
  });

  it('rehydrates an already-running response instead of waiting for a broadcast', async () => {
    const status = vi
      .fn()
      .mockResolvedValueOnce(runtimeOk(stopped))
      .mockResolvedValueOnce(runtimeOk(running));
    const client = runtime({
      status,
      start: vi.fn(async () => runtimeError('already-running', 'already active')),
    });
    const ap = await mounted(client);

    await ap.start();

    expect(status).toHaveBeenCalledTimes(2);
    expect(ap.status.value).toEqual(running);
    expect(ap.startHint.value).toMatch(/уже запущен/i);
  });

  it('stops the hydrated runId and applies the response immediately', async () => {
    const client = runtime({ status: vi.fn(async () => runtimeOk(running)) });
    const ap = await mounted(client);

    const stopPromise = ap.stop();
    expect(ap.pending.value).toBe('stopping');
    await stopPromise;

    expect(client.stop).toHaveBeenCalledWith({ type: 'STOP_AUTOPILOT', runId: 'run-1' });
    expect(ap.status.value).toMatchObject({ running: false, stopReason: 'manual' });
    expect(ap.pending.value).toBeNull();
  });

  it('rehydrates a missing runId before STOP and refreshes after a stale-run result', async () => {
    const active = { ...running, runId: 'run-new' };
    const status = vi
      .fn()
      .mockResolvedValueOnce(runtimeOk(stopped))
      .mockResolvedValueOnce(runtimeOk(active))
      .mockResolvedValueOnce(runtimeOk(active));
    const client = runtime({
      status,
      stop: vi.fn(async () => runtimeError('stale-run', 'old run')),
    });
    const ap = await mounted(client);

    await ap.stop();

    expect(client.stop).toHaveBeenCalledWith({ type: 'STOP_AUTOPILOT', runId: 'run-new' });
    expect(status).toHaveBeenCalledTimes(3);
    expect(ap.status.value).toEqual(active);
    expect(ap.pending.value).toBeNull();
  });

  it('uses a newer running broadcast when the fallback STOP hydration fails', async () => {
    const fallback = deferred<ReturnType<typeof runtimeError>>();
    const status = vi
      .fn()
      .mockResolvedValueOnce(runtimeOk(stopped))
      .mockImplementationOnce(() => fallback.promise);
    const client = runtime({ status });
    const ap = await mounted(client);

    const stopPromise = ap.stop();
    listener?.({ type: 'AUTOPILOT_STATUS', status: running });
    fallback.resolve(runtimeError('transport-error', 'old GET failed', true));
    await stopPromise;

    expect(client.stop).toHaveBeenCalledWith({ type: 'STOP_AUTOPILOT', runId: 'run-1' });
    expect(ap.pending.value).toBeNull();
  });
});

describe('runtime failure hints', () => {
  it.each([
    ['no-modules', 'модул'],
    ['paused', 'пауза'],
    ['already-running', 'уже запущен'],
    ['recovery-required', 'предыдущ'],
    ['stale-run', 'статус'],
    ['no-linkedin-tab', 'LinkedIn'],
    ['missing-host-permission', 'доступ'],
    ['navigation-failed', 'лент'],
    ['unsupported-dom', 'размет'],
    ['transport-error', 'фоновый процесс'],
    ['timeout', 'не ответило'],
    ['protocol-error', 'верс'],
    ['not-authenticated', 'авториз'],
    ['internal-error', 'внутренняя'],
  ] satisfies Array<[RuntimeErrorCode, string]>)(
    'maps %s to an actionable Russian hint',
    (code, fragment) => {
      expect(runtimeFailureHint(code)).toMatch(new RegExp(fragment, 'i'));
    },
  );
});
