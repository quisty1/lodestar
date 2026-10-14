export interface RunRecoveryLifecycleChrome {
  runtime: {
    onInstalled: Pick<typeof chrome.runtime.onInstalled, 'addListener'>;
    onStartup: Pick<typeof chrome.runtime.onStartup, 'addListener'>;
  };
  tabs: {
    onRemoved: Pick<typeof chrome.tabs.onRemoved, 'addListener'>;
    onUpdated: Pick<typeof chrome.tabs.onUpdated, 'addListener'>;
  };
  windows: {
    onRemoved: Pick<typeof chrome.windows.onRemoved, 'addListener'>;
  };
}

export interface RunRecoveryLifecycleHandlers {
  recover(): void | Promise<void>;
  tabRemoved(tabId: number): void | Promise<void>;
  tabUpdated(
    tabId: number,
    change: { url?: string; status?: 'loading' | 'complete' },
  ): void | Promise<void>;
  windowRemoved(windowId: number): void | Promise<void>;
}

/** Registers the production Chrome lifecycle boundary used to supervise persisted runs. */
export function registerRunRecoveryLifecycle(
  chromeApi: RunRecoveryLifecycleChrome,
  handlers: RunRecoveryLifecycleHandlers,
): void {
  chromeApi.runtime.onInstalled.addListener(() => {
    run(() => handlers.recover());
  });
  chromeApi.runtime.onStartup.addListener(() => {
    run(() => handlers.recover());
  });
  chromeApi.tabs.onRemoved.addListener((tabId) => {
    run(() => handlers.tabRemoved(tabId));
  });
  chromeApi.tabs.onUpdated.addListener((tabId, changeInfo) => {
    const change: { url?: string; status?: 'loading' | 'complete' } = {};
    if (typeof changeInfo.url === 'string') change.url = changeInfo.url;
    if (changeInfo.status === 'loading' || changeInfo.status === 'complete')
      change.status = changeInfo.status;
    if (change.url !== undefined || change.status !== undefined) {
      run(() => handlers.tabUpdated(tabId, change));
    }
  });
  chromeApi.windows.onRemoved.addListener((windowId) => {
    run(() => handlers.windowRemoved(windowId));
  });
}

function run(operation: () => void | Promise<void>): void {
  void Promise.resolve()
    .then(operation)
    .catch(() => undefined);
}
