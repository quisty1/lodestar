import { describe, expect, it, vi } from 'vitest';
import { registerRunRecoveryLifecycle, type RunRecoveryLifecycleHandlers } from './runLifecycle';
import { RunSupervisor } from './runSupervisor';
import type { AutopilotState } from '@lib/types';

type Listener = (...args: never[]) => void;

function capturedEvent<T extends Listener>() {
  let listener: T | undefined;
  return {
    event: {
      addListener: vi.fn((next: T) => {
        listener = next;
      }),
    },
    trigger: (...args: Parameters<T>) => {
      if (!listener) throw new Error('listener not registered');
      listener(...args);
    },
  };
}

describe('registered run recovery lifecycle boundary', () => {
  it('routes captured Chrome lifecycle callbacks to scoped recovery handlers', async () => {
    const installed = capturedEvent<(details: chrome.runtime.InstalledDetails) => void>();
    const startup = capturedEvent<() => void>();
    const tabRemoved =
      capturedEvent<(tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void>();
    const tabUpdated =
      capturedEvent<
        (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void
      >();
    const windowRemoved = capturedEvent<(windowId: number) => void>();
    const handlers: RunRecoveryLifecycleHandlers = {
      recover: vi.fn(async () => undefined),
      tabRemoved: vi.fn(async () => undefined),
      tabUpdated: vi.fn(async () => undefined),
      windowRemoved: vi.fn(async () => undefined),
    };

    registerRunRecoveryLifecycle(
      {
        runtime: { onInstalled: installed.event, onStartup: startup.event },
        tabs: { onRemoved: tabRemoved.event, onUpdated: tabUpdated.event },
        windows: { onRemoved: windowRemoved.event },
      },
      handlers,
    );

    vi.stubGlobal('chrome', {
      runtime: { OnInstalledReason: { INSTALL: 'install' } },
    });
    installed.trigger({ reason: chrome.runtime.OnInstalledReason.INSTALL });
    startup.trigger();
    tabRemoved.trigger(7, { windowId: 3, isWindowClosing: false });
    tabUpdated.trigger(7, { status: 'complete' }, {} as chrome.tabs.Tab);
    tabUpdated.trigger(7, { url: 'https://www.linkedin.com/in/me/' }, {} as chrome.tabs.Tab);
    windowRemoved.trigger(3);
    await vi.waitFor(() => {
      expect(handlers.windowRemoved).toHaveBeenCalledOnce();
    });

    expect(handlers.recover).toHaveBeenCalledTimes(2);
    expect(handlers.tabRemoved).toHaveBeenCalledWith(7);
    expect(handlers.tabUpdated).toHaveBeenCalledTimes(2);
    expect(handlers.tabUpdated).toHaveBeenNthCalledWith(1, 7, { status: 'complete' });
    expect(handlers.tabUpdated).toHaveBeenNthCalledWith(2, 7, {
      url: 'https://www.linkedin.com/in/me/',
    });
    expect(handlers.windowRemoved).toHaveBeenCalledWith(3);
  });

  it('routes a status-only feed reload through the supervisor to one interrupted report', async () => {
    const installed = capturedEvent<(details: chrome.runtime.InstalledDetails) => void>();
    const startup = capturedEvent<() => void>();
    const tabRemoved =
      capturedEvent<(tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void>();
    const tabUpdated =
      capturedEvent<
        (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void
      >();
    const windowRemoved = capturedEvent<(windowId: number) => void>();
    const current: AutopilotState = {
      running: true,
      host: 'tab',
      tabId: 7,
      day: '2026-08-11',
      ceiling: 30,
      used: 0,
      actionTimestamps: [],
      actionsSinceBreak: 0,
      manualStop: false,
      startedAt: '2026-08-11T10:00:00.000Z',
      runId: 'run-1',
      startRequestId: 'request-1',
      phase: 'feed_loop',
      startedUsed: 0,
      riskMarkers: [],
      updatedAt: '2026-08-11T10:00:00.000Z',
    };
    const report = vi.fn();
    const supervisor = new RunSupervisor({
      getState: async () => current,
      recoverInterrupted: async () => null,
      finalizeInterrupted: async (runId) => {
        report(runId);
      },
      getTab: async () => ({ id: 7, url: 'https://www.linkedin.com/feed/', status: 'complete' }),
      ping: async () => null,
      sleep: async () => undefined,
    });

    registerRunRecoveryLifecycle(
      {
        runtime: { onInstalled: installed.event, onStartup: startup.event },
        tabs: { onRemoved: tabRemoved.event, onUpdated: tabUpdated.event },
        windows: { onRemoved: windowRemoved.event },
      },
      {
        recover: () => supervisor.reconcile(),
        tabRemoved: (tabId) => supervisor.onTabRemoved(tabId),
        tabUpdated: (tabId, changeInfo) => supervisor.onTabUpdated(tabId, changeInfo),
        windowRemoved: async () => undefined,
      },
    );

    tabUpdated.trigger(7, { status: 'complete' }, {} as chrome.tabs.Tab);
    await vi.waitFor(() => {
      expect(report).toHaveBeenCalledOnce();
    });
    expect(report).toHaveBeenCalledWith('run-1');
  });
});
