import { describe, expect, it, vi } from 'vitest';
import {
  REFRESH_ALARM,
  REFRESH_PERIOD_MINUTES,
  ensureExtensionStartup,
  registerExtensionStartup,
} from './extensionStartup';

describe('extension startup initializer', () => {
  it('configures the side panel and creates the missing refresh alarm', async () => {
    const deps = {
      configureSidePanel: vi.fn(async () => undefined),
      getAlarm: vi.fn(async () => undefined),
      createAlarm: vi.fn(async () => undefined),
      onError: vi.fn(),
    };

    await ensureExtensionStartup(deps);

    expect(deps.configureSidePanel).toHaveBeenCalledOnce();
    expect(deps.getAlarm).toHaveBeenCalledWith(REFRESH_ALARM);
    expect(deps.createAlarm).toHaveBeenCalledWith(REFRESH_ALARM, {
      periodInMinutes: REFRESH_PERIOD_MINUTES,
    });
    expect(deps.onError).not.toHaveBeenCalled();
  });

  it('does not recreate an existing alarm', async () => {
    const deps = {
      configureSidePanel: vi.fn(async () => undefined),
      getAlarm: vi.fn(async () => ({ name: REFRESH_ALARM })),
      createAlarm: vi.fn(async () => undefined),
      onError: vi.fn(),
    };

    await ensureExtensionStartup(deps);

    expect(deps.createAlarm).not.toHaveBeenCalled();
  });

  it('runs panel and alarm setup independently when either side fails', async () => {
    const panelError = new Error('panel unavailable');
    const alarmError = new Error('alarms unavailable');
    const panelFailure = {
      configureSidePanel: vi.fn(async () => {
        throw panelError;
      }),
      getAlarm: vi.fn(async () => undefined),
      createAlarm: vi.fn(async () => undefined),
      onError: vi.fn(),
    };
    await ensureExtensionStartup(panelFailure);
    expect(panelFailure.createAlarm).toHaveBeenCalledOnce();
    expect(panelFailure.onError).toHaveBeenCalledWith('side-panel', panelError);

    const alarmFailure = {
      configureSidePanel: vi.fn(async () => undefined),
      getAlarm: vi.fn(async () => {
        throw alarmError;
      }),
      createAlarm: vi.fn(async () => undefined),
      onError: vi.fn(),
    };
    await ensureExtensionStartup(alarmFailure);
    expect(alarmFailure.configureSidePanel).toHaveBeenCalledOnce();
    expect(alarmFailure.onError).toHaveBeenCalledWith('refresh-alarm', alarmError);
  });

  it('runs once on cold evaluation and again through captured install/startup callbacks', async () => {
    let installed: (() => void) | undefined;
    let startup: (() => void) | undefined;
    const api = {
      runtime: {
        onInstalled: {
          addListener: vi.fn((listener: () => void) => {
            installed = listener;
          }),
        },
        onStartup: {
          addListener: vi.fn((listener: () => void) => {
            startup = listener;
          }),
        },
      },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
      alarms: {
        get: vi.fn(async () => ({ name: REFRESH_ALARM })),
        create: vi.fn(async () => undefined),
      },
    };

    registerExtensionStartup(api);
    await vi.waitFor(() => {
      expect(api.sidePanel.setPanelBehavior).toHaveBeenCalledTimes(1);
    });
    installed!();
    await vi.waitFor(() => {
      expect(api.sidePanel.setPanelBehavior).toHaveBeenCalledTimes(2);
    });
    startup!();
    await vi.waitFor(() => {
      expect(api.sidePanel.setPanelBehavior).toHaveBeenCalledTimes(3);
    });

    expect(api.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });
});
