export const REFRESH_ALARM = 'lodestar:ssi-refresh';
export const REFRESH_PERIOD_MINUTES = 6 * 60;

type StartupScope = 'side-panel' | 'refresh-alarm';

export interface ExtensionStartupDeps {
  configureSidePanel(): Promise<void>;
  getAlarm(name: string): Promise<unknown>;
  createAlarm(name: string, info: { periodInMinutes: number }): Promise<void> | void;
  onError(scope: StartupScope, error: unknown): void;
}

export interface ExtensionStartupApi {
  runtime: {
    onInstalled: { addListener(listener: () => void): void };
    onStartup: { addListener(listener: () => void): void };
  };
  sidePanel: {
    setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
  };
  alarms: {
    get(name: string): Promise<unknown>;
    create(name: string, info: { periodInMinutes: number }): Promise<void> | void;
  };
}

/** Re-establishes MV3 state that Chrome may lose between worker/browser starts. */
export async function ensureExtensionStartup(deps: ExtensionStartupDeps): Promise<void> {
  await Promise.all([
    independently(
      'side-panel',
      () => deps.configureSidePanel(),
      (scope, error) => {
        deps.onError(scope, error);
      },
    ),
    independently(
      'refresh-alarm',
      async () => {
        if (await deps.getAlarm(REFRESH_ALARM)) return;
        await deps.createAlarm(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MINUTES });
      },
      (scope, error) => {
        deps.onError(scope, error);
      },
    ),
  ]);
}

/** Registers install/startup callbacks and also runs on cold worker evaluation. */
export function registerExtensionStartup(
  api: ExtensionStartupApi,
  onError: ExtensionStartupDeps['onError'] = (scope, error) => {
    console.error(`[Lodestar] ${scope} startup failed`, error);
  },
): void {
  let inFlight: Promise<void> | null = null;
  let rerunRequested = false;
  const ensure = () => {
    if (inFlight) {
      rerunRequested = true;
      return inFlight;
    }
    inFlight = ensureExtensionStartup({
      configureSidePanel: () => api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }),
      getAlarm: (name) => api.alarms.get(name),
      createAlarm: (name, info) => api.alarms.create(name, info),
      onError,
    }).finally(() => {
      inFlight = null;
      if (rerunRequested) {
        rerunRequested = false;
        void ensure();
      }
    });
    return inFlight;
  };

  void ensure();
  api.runtime.onInstalled.addListener(() => {
    void ensure();
  });
  api.runtime.onStartup.addListener(() => {
    void ensure();
  });
}

async function independently(
  scope: StartupScope,
  operation: () => Promise<void>,
  onError: ExtensionStartupDeps['onError'],
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    onError(scope, error);
  }
}
