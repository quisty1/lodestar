import { describe, expect, it, vi } from 'vitest';
import { registerAutopilotRuntime, type AutopilotRuntimeHandlers } from './autopilotRuntime';
import { WORKER_PROTOCOL_VERSION, runtimeError, runtimeOk } from '@lib/runtimeProtocol';
import type { EffectDescriptor } from '@lib/types';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(overrides: Partial<AutopilotRuntimeHandlers> = {}) {
  let listener: Listener | undefined;
  const event = {
    addListener: vi.fn((next: Listener) => {
      listener = next;
    }),
  };
  const status = { running: false, used: 0, ceiling: 30, revision: 0 };
  const handlers: AutopilotRuntimeHandlers = {
    status: vi.fn(async () => runtimeOk(status)),
    start: vi.fn(async () =>
      runtimeOk({
        started: true as const,
        duplicate: false,
        runId: 'run-1',
        status: { ...status, running: true, revision: 1, runId: 'run-1' },
      }),
    ),
    stop: vi.fn(async () =>
      runtimeOk({
        stopped: true,
        runId: 'run-1',
        status: { ...status, revision: 2, runId: 'run-1', phase: 'finished' as const },
      }),
    ),
    mayAct: vi.fn(async () => ({ action: 'act' as const })),
    acted: vi.fn(async () => true),
    reserveEffect: vi.fn(async (_runId, requestId, descriptor: EffectDescriptor) => ({
      kind: 'reserved' as const,
      canExecute: true as const,
      effectId: 'effect-1',
      lease: {
        effectId: 'effect-1',
        requestId,
        descriptor,
        stage: 'reserved' as const,
        reservedAt: '2026-08-11T10:00:00.000Z',
      },
    })),
    commitEffect: vi.fn(async () => ({
      kind: 'rejected' as const,
      admitted: false as const,
      reason: 'not-found' as const,
    })),
    settleEffect: vi.fn(async () => ({ kind: 'rejected' as const, reason: 'not-found' as const })),
    risk: vi.fn(async () => true),
    ended: vi.fn(async () => true),
    ...overrides,
  };
  registerAutopilotRuntime(event, handlers);
  if (!listener) throw new Error('listener not registered');
  const dispatch = (message: unknown, sender: unknown = {}) =>
    new Promise<{ async: boolean; response: unknown }>((resolve) => {
      let async = false;
      const responsePromise = new Promise<unknown>((done) => {
        async = listener!(message, sender, done);
      });
      void responsePromise.then((response) => {
        resolve({ async, response });
      });
    });
  return { handlers, dispatch };
}

describe('registered autopilot runtime boundary', () => {
  it('answers worker PING with the exact protocol version', async () => {
    const { dispatch } = setup();

    expect(await dispatch({ type: 'PING' })).toEqual({
      async: false,
      response: { type: 'PONG', protocolVersion: WORKER_PROTOCOL_VERSION },
    });
  });

  it('returns a typed status envelope', async () => {
    const { dispatch } = setup();

    expect(await dispatch({ type: 'GET_AUTOPILOT_STATUS' })).toEqual({
      async: true,
      response: runtimeOk({ running: false, used: 0, ceiling: 30, revision: 0 }),
    });
  });

  it('passes stable request ids and returns the typed START response', async () => {
    const { handlers, dispatch } = setup();

    const result = await dispatch({ type: 'START_AUTOPILOT', host: 'tab', requestId: 'request-1' });

    expect(handlers.start).toHaveBeenCalledWith('tab', 'request-1');
    expect(result.response).toMatchObject({ ok: true, data: { runId: 'run-1' } });
  });

  it('deduplicates one requestId to the exact in-flight and settled START result', async () => {
    const pending = deferred<ReturnType<typeof runtimeError>>();
    const start = vi.fn(() => pending.promise);
    const { handlers, dispatch } = setup({ start });
    const request = { type: 'START_AUTOPILOT', host: 'tab', requestId: 'request-lost-response' };

    const first = dispatch(request);
    const retry = dispatch({ ...request });
    expect(handlers.start).toHaveBeenCalledTimes(1);

    const failure = runtimeError('navigation-failed', 'LinkedIn feed did not finish loading', true);
    pending.resolve(failure);
    await expect(first).resolves.toEqual({ async: true, response: failure });
    await expect(retry).resolves.toEqual({ async: true, response: failure });

    await expect(dispatch({ ...request })).resolves.toEqual({ async: true, response: failure });
    expect(handlers.start).toHaveBeenCalledTimes(1);
  });

  it('does not deduplicate different START request ids', async () => {
    const { handlers, dispatch } = setup();

    await Promise.all([
      dispatch({ type: 'START_AUTOPILOT', host: 'tab', requestId: 'request-1' }),
      dispatch({ type: 'START_AUTOPILOT', host: 'tab', requestId: 'request-2' }),
    ]);

    expect(handlers.start).toHaveBeenCalledTimes(2);
  });

  it('preserves the legacy START response while requestId is absent', async () => {
    const { dispatch } = setup();

    expect((await dispatch({ type: 'START_AUTOPILOT', host: 'tab' })).response).toMatchObject({
      started: true,
      runId: 'run-1',
    });
  });

  it('preserves the legacy STOP ack while runId is absent', async () => {
    const { handlers, dispatch } = setup();

    expect((await dispatch({ type: 'STOP_AUTOPILOT' })).response).toEqual({ ok: true });
    expect(handlers.stop).toHaveBeenCalledWith(undefined);
  });

  it('settles typed STOP with its scoped run id and full response envelope', async () => {
    const status = {
      running: false,
      used: 4,
      ceiling: 30,
      revision: 2,
      runId: 'run-1',
      phase: 'finished' as const,
    };
    const stop = vi.fn(async () => runtimeOk({ stopped: true, runId: 'run-1', status }));
    const { dispatch } = setup({ stop });

    expect(await dispatch({ type: 'STOP_AUTOPILOT', runId: 'run-1' })).toEqual({
      async: true,
      response: runtimeOk({ stopped: true, runId: 'run-1', status }),
    });
    expect(stop).toHaveBeenCalledWith('run-1');
  });

  it('preserves stale-run scoping for typed STOP', async () => {
    const stop = vi.fn(async () =>
      runtimeError('stale-run', 'The requested run is no longer active'),
    );
    const { dispatch } = setup({ stop });

    expect(await dispatch({ type: 'STOP_AUTOPILOT', runId: 'old-run' })).toEqual({
      async: true,
      response: runtimeError('stale-run', 'The requested run is no longer active'),
    });
    expect(stop).toHaveBeenCalledWith('old-run');
  });

  it('rejects a stale scoped action without touching coordinator state', async () => {
    const acted = vi.fn(async () => false);
    const { dispatch } = setup({ acted });

    expect(
      (await dispatch({ type: 'AUTOPILOT_ACTED', runId: 'old-run', ok: true })).response,
    ).toEqual({ ok: false });
    expect(acted).toHaveBeenCalledWith('old-run', true);
  });

  it('crosses the registered Chrome callback with the sender tab for all effect phases', async () => {
    const { handlers, dispatch } = setup();
    const sender = { tab: { id: 42 } };
    const descriptor = { kind: 'like' as const, targetKey: 'urn:li:activity:1' };

    await dispatch(
      { type: 'AUTOPILOT_RESERVE_EFFECT', runId: 'run-1', requestId: 'request-1', descriptor },
      sender,
    );
    await dispatch(
      {
        type: 'AUTOPILOT_COMMIT_EFFECT',
        runId: 'run-1',
        effectId: 'effect-1',
        requestId: 'request-1',
        attemptId: 'attempt-1',
      },
      sender,
    );
    await dispatch(
      {
        type: 'AUTOPILOT_SETTLE_EFFECT',
        runId: 'run-1',
        effectId: 'effect-1',
        requestId: 'request-1',
        attemptId: 'attempt-1',
        outcome: 'confirmed',
      },
      sender,
    );

    expect(handlers.reserveEffect).toHaveBeenCalledWith('run-1', 'request-1', descriptor, 42);
    expect(handlers.commitEffect).toHaveBeenCalledWith(
      'run-1',
      'effect-1',
      'request-1',
      'attempt-1',
      42,
    );
    expect(handlers.settleEffect).toHaveBeenCalledWith(
      'run-1',
      'effect-1',
      'request-1',
      'confirmed',
      { attemptId: 'attempt-1', reason: undefined },
      42,
    );
  });

  it('rejects malformed or extension-page effect messages before handlers run', async () => {
    const { handlers, dispatch } = setup();

    expect(
      (
        await dispatch(
          {
            type: 'AUTOPILOT_RESERVE_EFFECT',
            runId: 'run-1',
            requestId: 'request-1',
            descriptor: { kind: 'like' },
          },
          { tab: { id: 42 } },
        )
      ).response,
    ).toEqual({ kind: 'invalid', canExecute: false });
    expect(
      (
        await dispatch({
          type: 'AUTOPILOT_COMMIT_EFFECT',
          runId: 'run-1',
          effectId: 'effect-1',
          requestId: 'request-1',
          attemptId: 'attempt-1',
        })
      ).response,
    ).toEqual({ kind: 'rejected', admitted: false, reason: 'identity' });
    expect(handlers.reserveEffect).not.toHaveBeenCalled();
    expect(handlers.commitEffect).not.toHaveBeenCalled();
  });

  it('maps a typed no-modules failure to the legacy start contract', async () => {
    const { dispatch } = setup({
      start: vi.fn(async () => runtimeError('no-modules', 'No enabled modules')),
    });

    expect((await dispatch({ type: 'START_AUTOPILOT', host: 'tab' })).response).toEqual({
      started: false,
      reason: 'no-modules',
    });
  });

  it('turns a rejected typed handler into one settled error response', async () => {
    let listener: Listener | undefined;
    const event = {
      addListener: vi.fn((next: Listener) => {
        listener = next;
      }),
    };
    registerAutopilotRuntime(event, {
      ...setup().handlers,
      status: vi.fn(async () => {
        throw new Error('storage unavailable');
      }),
    });
    const sendResponse = vi.fn();

    expect(listener!({ type: 'GET_AUTOPILOT_STATUS' }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledTimes(1);
    });
    expect(sendResponse).toHaveBeenCalledWith(
      runtimeError('internal-error', 'Autopilot runtime failed', true),
    );
  });
});
