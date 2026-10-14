import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import {
  MODULE_STATE_SCHEMA_VERSION,
  MODULE_STATE_VERSION_KEY,
  MODULES_STATE_KEY,
  defaultModules,
} from '@lib/modules/moduleState';
import { WORKER_PROTOCOL_VERSION, runtimeOk } from '@lib/runtimeProtocol';
import App from './App.vue';

const stopped = { running: false, used: 0, ceiling: 30, revision: 0 };
const running = {
  ...stopped,
  running: true,
  revision: 1,
  runId: 'run-1',
  phase: 'starting' as const,
  recoveryRequired: false,
};

function runtimeResponse(message: { type: string }) {
  if (message.type === 'PING') return { type: 'PONG', protocolVersion: WORKER_PROTOCOL_VERSION };
  if (message.type === 'GET_AUTOPILOT_STATUS') return runtimeOk(stopped);
  if (message.type === 'START_AUTOPILOT') {
    return runtimeOk({
      started: true,
      duplicate: false,
      runId: 'run-1',
      status: running,
    });
  }
  if (message.type === 'STOP_AUTOPILOT') {
    return runtimeOk({
      stopped: true,
      runId: 'run-1',
      status: {
        ...stopped,
        revision: 2,
        runId: 'run-1',
        phase: 'finished',
        stopReason: 'manual',
      },
    });
  }
  if (message.type === 'LIST_REPORTS') return [];
  return { ok: true };
}

async function mountApp() {
  const wrapper = mount(App, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

describe('App (side panel)', () => {
  it('renders the Lodestar brand and starts on the SSI screen', async () => {
    const w = await mountApp();
    expect(w.find('.brand h1').text()).toBe('Lodestar');
    expect(w.find('#v-dash').exists()).toBe(true);
    expect(w.text()).toContain('SSI');
  });

  it('shows an empty SSI state until a real snapshot arrives', async () => {
    const w = await mountApp();
    expect(w.find('[data-testid="ssi-empty"]').exists()).toBe(true);
    expect(w.find('[data-testid="gauge-num"]').exists()).toBe(false);
    expect(w.text()).toContain('Индекса ещё нет');
  });

  it('opens the audit screen from Dashboard without starting a scan', async () => {
    Reflect.deleteProperty(globalThis, 'chrome');
    const w = await mountApp();

    await w.get('[data-testid="open-audit"]').trigger('click');
    await flushPromises();

    expect(w.find('#v-profile').exists()).toBe(true);
    expect(w.get('[data-testid="start-profile-audit"]').text()).toContain('Запустить аудит');
  });

  it('switches to the Modules screen from overview', async () => {
    const w = await mountApp();
    await w.find('[data-testid="open-modules"]').trigger('click');
    expect(w.find('#v-auto').exists()).toBe(true);
    expect(w.text()).toContain('Модули автоматизации');
  });

  it('toggles a module off and on', async () => {
    const w = await mountApp();
    await w.find('[data-testid="open-modules"]').trigger('click');
    const toggle = w.find('[data-testid="toggle-engagement"]');
    expect(toggle.classes()).toContain('on');
    await toggle.trigger('click');
    expect(w.find('[data-testid="toggle-engagement"]').classes()).not.toContain('on');
  });

  it('edits the engagement daily limit', async () => {
    const w = await mountApp();
    await w.find('[data-testid="open-modules"]').trigger('click');
    const input = w.find('[data-testid="limit-engagement"]');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe('35');
    await input.setValue('50');
    await input.trigger('change');
    expect((w.find('[data-testid="limit-engagement"]').element as HTMLInputElement).value).toBe(
      '50',
    );
  });

  it('waits for queued module persistence before sending an immediate START', async () => {
    const mem = new Map<string, unknown>([
      [MODULES_STATE_KEY, defaultModules()],
      [MODULE_STATE_VERSION_KEY, MODULE_STATE_SCHEMA_VERSION],
    ]);
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const sent: Array<{ type: string }> = [];
    const sendMessage = vi.fn(async (message: { type: string }) => {
      sent.push(message);
      return runtimeResponse(message);
    });

    (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
      runtime: {
        id: 'test-extension',
        sendMessage,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: mem.get(key) })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            if (MODULES_STATE_KEY in values) await writeGate;
            for (const [key, value] of Object.entries(values)) mem.set(key, value);
          }),
        },
      },
    } as unknown as typeof chrome;

    const w = await mountApp();
    sent.length = 0; // ignore mount hydration/refresh messages
    await w.find('[data-testid="open-modules"]').trigger('click');
    await w.find('[data-testid="toggle-engagement"]').trigger('click');
    const limit = w.find('[data-testid="limit-engagement"]');
    (limit.element as HTMLInputElement).value = '50';
    await limit.trigger('change');
    await w.find('[data-testid="nav-v-dash"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="ap-launch"]').trigger('click');
    await flushPromises();

    expect(sent.filter((message) => message.type === 'START_AUTOPILOT')).toHaveLength(0);
    expect(w.find('[data-testid="ap-launch"]').text()).toBe('Запускаю…');
    expect(w.find('[data-testid="ap-launch"]').attributes('disabled')).toBeDefined();

    releaseWrite();
    await flushPromises();
    expect(sent.filter((message) => message.type === 'START_AUTOPILOT')).toHaveLength(1);

    w.unmount();
    Reflect.deleteProperty(globalThis, 'chrome');
  });

  it('blocks START after a rejected module read, surfaces the error, then retries safely', async () => {
    const mem = new Map<string, unknown>([
      [MODULES_STATE_KEY, defaultModules()],
      [MODULE_STATE_VERSION_KEY, MODULE_STATE_SCHEMA_VERSION],
    ]);
    let rejectRead = true;
    const sent: Array<{ type: string }> = [];
    const sendMessage = vi.fn(async (message: { type: string }) => {
      sent.push(message);
      return runtimeResponse(message);
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
      runtime: {
        id: 'test-extension',
        sendMessage,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => {
            if (key === MODULES_STATE_KEY && rejectRead) throw new Error('storage read failed');
            return { [key]: mem.get(key) };
          }),
          set: vi.fn(async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) mem.set(key, value);
          }),
        },
      },
    } as unknown as typeof chrome;

    const w = await mountApp();
    sent.length = 0;
    await w.find('[data-testid="ap-launch"]').trigger('click');
    await flushPromises();

    expect(sent.filter((message) => message.type === 'START_AUTOPILOT')).toHaveLength(0);
    expect(w.find('[data-testid="ap-no-modules"]').text()).toContain('сохранить настройки');
    expect(w.find('[data-testid="ap-launch"]').attributes('disabled')).toBeUndefined();

    rejectRead = false;
    await w.find('[data-testid="ap-launch"]').trigger('click');
    await flushPromises();
    expect(sent.filter((message) => message.type === 'START_AUTOPILOT')).toHaveLength(1);

    w.unmount();
    consoleError.mockRestore();
    Reflect.deleteProperty(globalThis, 'chrome');
  });

  it('blocks START after a rejected module write, preserves dirty state, then retries safely', async () => {
    const mem = new Map<string, unknown>([
      [MODULES_STATE_KEY, defaultModules()],
      [MODULE_STATE_VERSION_KEY, MODULE_STATE_SCHEMA_VERSION],
    ]);
    let rejectWrite = true;
    const sent: Array<{ type: string }> = [];
    const sendMessage = vi.fn(async (message: { type: string }) => {
      sent.push(message);
      return runtimeResponse(message);
    });
    (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
      runtime: {
        id: 'test-extension',
        sendMessage,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: mem.get(key) })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            if (MODULES_STATE_KEY in values && rejectWrite) throw new Error('storage write failed');
            for (const [key, value] of Object.entries(values)) mem.set(key, value);
          }),
        },
      },
    } as unknown as typeof chrome;

    const w = await mountApp();
    sent.length = 0;
    await w.find('[data-testid="open-modules"]').trigger('click');
    await w.find('[data-testid="toggle-engagement"]').trigger('click');
    await w.find('[data-testid="nav-v-dash"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="ap-launch"]').trigger('click');
    await flushPromises();

    expect(sent.filter((message) => message.type === 'START_AUTOPILOT')).toHaveLength(0);
    expect(w.find('[data-testid="ap-no-modules"]').text()).toContain('сохранить настройки');
    expect(w.find('[data-testid="ap-launch"]').attributes('disabled')).toBeUndefined();

    rejectWrite = false;
    await w.find('[data-testid="ap-launch"]').trigger('click');
    await flushPromises();
    expect(sent.filter((message) => message.type === 'START_AUTOPILOT')).toHaveLength(1);
    expect(
      (mem.get(MODULES_STATE_KEY) as Array<{ id: string; enabled: boolean }>).find(
        (module) => module.id === 'engagement',
      )?.enabled,
    ).toBe(false);

    w.unmount();
    Reflect.deleteProperty(globalThis, 'chrome');
  });

  it('reopens on a running worker and stops that exact run without a broadcast', async () => {
    const mem = new Map<string, unknown>([
      [MODULES_STATE_KEY, defaultModules()],
      [MODULE_STATE_VERSION_KEY, MODULE_STATE_SCHEMA_VERSION],
    ]);
    const sent: Array<{ type: string; runId?: string }> = [];
    const sendMessage = vi.fn(async (message: { type: string; runId?: string }) => {
      sent.push(message);
      if (message.type === 'PING')
        return { type: 'PONG', protocolVersion: WORKER_PROTOCOL_VERSION };
      if (message.type === 'GET_AUTOPILOT_STATUS') return runtimeOk(running);
      if (message.type === 'STOP_AUTOPILOT') {
        const runId = message.runId ?? '';
        return runtimeOk({
          stopped: true,
          runId,
          status: {
            ...stopped,
            revision: 2,
            runId,
            phase: 'finished',
            stopReason: 'manual',
          },
        });
      }
      if (message.type === 'LIST_REPORTS') return [];
      return { ok: true };
    });
    (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
      runtime: {
        id: 'test-extension',
        sendMessage,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: mem.get(key) })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) mem.set(key, value);
          }),
        },
      },
    } as unknown as typeof chrome;

    const w = await mountApp();
    expect(w.find('[data-testid="ap-launch"]').text()).toBe('Остановить');

    await w.find('[data-testid="ap-launch"]').trigger('click');
    await flushPromises();

    expect(sent.filter((message) => message.type === 'STOP_AUTOPILOT')).toEqual([
      { type: 'STOP_AUTOPILOT', runId: 'run-1' },
    ]);
    expect(w.find('[data-testid="ap-launch"]').text()).toBe('Запустить');

    w.unmount();
    Reflect.deleteProperty(globalThis, 'chrome');
  });

  it('settles START with a protocol hint when the worker returns a terminal typed status', async () => {
    const mem = new Map<string, unknown>([
      [MODULES_STATE_KEY, defaultModules()],
      [MODULE_STATE_VERSION_KEY, MODULE_STATE_SCHEMA_VERSION],
    ]);
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'PING')
        return { type: 'PONG', protocolVersion: WORKER_PROTOCOL_VERSION };
      if (message.type === 'GET_AUTOPILOT_STATUS') return runtimeOk(stopped);
      if (message.type === 'START_AUTOPILOT') {
        return runtimeOk({
          started: true,
          duplicate: false,
          runId: 'run-1',
          status: {
            ...stopped,
            revision: 1,
            runId: 'run-1',
            phase: 'finished',
            recoveryRequired: false,
          },
        });
      }
      if (message.type === 'LIST_REPORTS') return [];
      return { ok: true };
    });
    (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
      runtime: {
        id: 'test-extension',
        sendMessage,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: mem.get(key) })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) mem.set(key, value);
          }),
        },
      },
    } as unknown as typeof chrome;

    const w = await mountApp();
    try {
      await w.find('[data-testid="ap-launch"]').trigger('click');
      await flushPromises();

      expect(w.find('[data-testid="ap-runtime-hint"]').text()).toContain(
        'Панель и расширение разных версий',
      );
      expect(w.find('[data-testid="ap-launch"]').text()).toBe('Запустить');
      expect(w.find('[data-testid="ap-launch"]').attributes('disabled')).toBeUndefined();
    } finally {
      w.unmount();
      Reflect.deleteProperty(globalThis, 'chrome');
    }
  });
});
