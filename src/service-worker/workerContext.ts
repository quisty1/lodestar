import { ChromeCookieCsrfProvider } from '@/adapters/ChromeCookieCsrfProvider';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import { ChromeWindows } from '@/adapters/ChromeWindows';
import { FetchHttpClient } from '@/adapters/FetchHttpClient';
import { MathRandomRng } from '@/adapters/MathRandomRng';
import { SystemClock } from '@/adapters/SystemClock';
import { randomId } from '@/adapters/randomId';
import { AutopilotGatekeeper } from '@lib/autopilot/AutopilotGatekeeper';
import { BurstGuard } from '@lib/autopilot/BurstGuard';
import { EffectAccountant } from '@lib/autopilot/EffectAccountant';
import { EffectService } from '@lib/autopilot/EffectService';
import { RiskAssessor } from '@lib/autopilot/RiskAssessor';
import { RunCoordinator } from '@lib/autopilot/RunCoordinator';
import { RunReportStore } from '@lib/autopilot/RunReportStore';
import { LinkedInSsiApiClient } from '@lib/ssi-api/LinkedInSsiApiClient';
import { LinkedInAccountClient } from '@lib/linkedin/LinkedInAccountClient';
import { ProfileAuditRepository } from '@lib/profile/ProfileAuditRepository';
import { WvmpApiClient } from '@lib/profileViews/WvmpApiClient';
import {
  BackgroundRefreshService,
  SnapshotRefreshService,
} from '@lib/refresh/BackgroundRefreshService';
import { RefreshPolicy } from '@lib/refresh/RefreshPolicy';
import { ProfileViewsRepository } from '@lib/storage/ProfileViewsRepository';
import { SsiRepository } from '@lib/storage/SsiRepository';
import type { ProfileViewsSnapshot, StopReason } from '@lib/types';
import { draftsWaiting } from './productSignals';
import { EffectRunFinalizer } from './EffectRunFinalizer';
import { WorkerEffectClient } from './WorkerEffectClient';
import { recoverEffectRetry, registerEffectRetryAlarm } from './effectRetryAlarm';
import { recoverPersistedEffects } from './effectRecovery';
import { refreshMetric } from './ssiRefreshRuntime';
import {
  containsLinkedInHostPermission,
  isContentPong,
  reloadChromeTab,
  type RunTargetDependencies,
  type TargetTab,
} from './runTarget';
import { RunSupervisor, startWorkerKeepAlive } from './runSupervisor';
import { broadcast, notify, reinjectContentScript, sleep } from './linkedinTabBridge';
import { bootstrapWorkerStorage } from './storageBootstrap';

const HOUR_MS = 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 24 * HOUR_MS;

export function createWorkerContext() {
  const store = new ChromeStorageStore();
  const clock = new SystemClock();
  const storageReady = bootstrapWorkerStorage({
    local: chrome.storage.local,
    store,
    client: new LinkedInAccountClient(new FetchHttpClient(), new ChromeCookieCsrfProvider()),
    clock,
  });
  const repo = new SsiRepository(store);
  const profileAuditRepo = new ProfileAuditRepository(store);
  const refresher = new BackgroundRefreshService({
    policy: new RefreshPolicy(REFRESH_INTERVAL_MS),
    apiClient: new LinkedInSsiApiClient(new FetchHttpClient(), new ChromeCookieCsrfProvider()),
    store,
    clock,
  });
  const pvRepo = new ProfileViewsRepository(store);
  const viewsRefresher = new SnapshotRefreshService<ProfileViewsSnapshot>({
    policy: new RefreshPolicy(REFRESH_INTERVAL_MS),
    apiClient: new WvmpApiClient(new FetchHttpClient(), new ChromeCookieCsrfProvider()),
    store,
    clock,
    lastRefreshKey: 'profileViews:lastRefreshAt',
  });
  const autopilotRng = new MathRandomRng();
  const reportsStore = new RunReportStore(store);
  const llmHttp = new FetchHttpClient();
  const gatekeeper = new AutopilotGatekeeper({
    burst: new BurstGuard(),
    risk: new RiskAssessor(),
  });
  const windows = new ChromeWindows();
  const coordinator = new RunCoordinator({
    store,
    clock,
    reports: reportsStore,
    createId: randomId,
    broadcast: (status) => {
      broadcast({ type: 'AUTOPILOT_STATUS', status });
    },
  });
  const effectAccountant = new EffectAccountant(store);
  const effects = new EffectService({ coordinator, accountant: effectAccountant, clock });
  const workerEffects = new WorkerEffectClient({ coordinator, effects, createId: randomId });
  const effectRetryAlarm = registerEffectRetryAlarm(chrome, {
    recover: () => recoverDurableEffectRetry(),
  });
  const runFinalizer = new EffectRunFinalizer({
    requestStop: (runId, reason) => coordinator.requestStop(runId, reason),
    reconcile: (runId) => coordinator.reconcileEffects(runId),
    stopContent: async (tabId, runId) => {
      if (!tabId) return;
      await Promise.race([
        chrome.tabs.sendMessage(tabId, { type: 'STOP_AUTOPILOT', runId }).catch(() => undefined),
        sleep(1_500),
      ]);
    },
    clearActivity: async (tabId) => {
      if (tabId)
        await chrome.tabs
          .sendMessage(tabId, { type: 'SET_ACTIVITY', active: false })
          .catch(() => undefined);
    },
    drain: (runId) => effects.drain(runId),
    finalize: (runId) => coordinator.finalize(runId),
    broadcastReport: (report) => {
      broadcast({ type: 'AUTOPILOT_REPORT', report });
    },
    scheduleDurableRetry: (_runId, delayMs) => {
      effectRetryAlarm.schedule(delayMs);
    },
    clearDurableRetry: () => {
      effectRetryAlarm.clear();
    },
  });
  const targetDeps: RunTargetDependencies = {
    hasHostPermission: () => containsLinkedInHostPermission(chrome.permissions),
    queryTabs: (query) => chrome.tabs.query(query) as Promise<TargetTab[]>,
    createTab: (url) => chrome.tabs.create({ url, active: true }) as Promise<TargetTab>,
    updateTab: (tabId, url) => chrome.tabs.update(tabId, { url }) as Promise<TargetTab>,
    getTab: (tabId) =>
      chrome.tabs
        .get(tabId)
        .then((tab) => tab as TargetTab)
        .catch(() => null),
    sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    reloadTab: (tabId) => reloadChromeTab(chrome.tabs, tabId),
    injectContentScript: reinjectContentScript,
    sleep,
    maxAttempts: 30,
  };
  const supervisor = new RunSupervisor({
    getState: () => coordinator.getState(),
    recoverInterrupted: () => recoverPersistedRun(),
    finalizeInterrupted: async (runId) => {
      await finalizeRun(runId, 'interrupted');
    },
    getTab: (tabId) => targetDeps.getTab(tabId),
    ping: async (tabId) => {
      const response = await targetDeps.sendMessage(tabId, { type: 'PING' }).catch(() => null);
      return isContentPong(response) ? response : null;
    },
    reinject: reinjectContentScript,
    sleep,
  });

  async function recoverPersistedRun() {
    await storageReady;
    return recoverPersistedEffects({
      getState: () => coordinator.getState(),
      finish: (runId, state) => runFinalizer.finish(runId, state),
      recover: () => effects.recover(),
      broadcast: (report) => {
        broadcast({ type: 'AUTOPILOT_REPORT', report });
      },
    });
  }

  async function recoverDurableEffectRetry(): Promise<void> {
    await storageReady;
    await recoverEffectRetry({
      getState: () => coordinator.getState(),
      finish: (runId, state) => runFinalizer.finish(runId, state),
      clear: () => {
        effectRetryAlarm.clear();
      },
    });
  }

  function finalizeRun(runId: string, reason: StopReason): Promise<void> {
    return runFinalizer
      .request(runId, reason)
      .then(() => runFinalizer.wait(runId))
      .then(async () => {
        notify(
          'Прогон Lodestar закончился',
          reason === 'completed' ? 'Цикл пройден.' : 'Прогон остановился раньше конца.',
        );
        const waiting = await draftsWaiting(store).catch(() => 0);
        if (waiting > 0)
          notify('Черновик ждёт одобрения', 'Пока пост не одобрен, неделя по бренду не закроется.');
      });
  }

  function refreshMetricsIfDue(): void {
    void refreshMetric(
      () => refresher.refreshIfDue(),
      (snapshot) => repo.save(snapshot),
      (snapshot) => {
        broadcast({ type: 'SSI_SNAPSHOT', payload: snapshot });
      },
      (error) => {
        console.error('[Lodestar] SSI scheduled refresh failed', error);
      },
    );
    void refreshMetric(
      () => viewsRefresher.refreshIfDue(),
      (snapshot) => pvRepo.save(snapshot),
      (snapshot) => {
        broadcast({ type: 'PROFILE_VIEWS_SNAPSHOT', payload: snapshot });
      },
      (error) => {
        console.error('[Lodestar] Profile views scheduled refresh failed', error);
      },
    );
  }

  void recoverPersistedRun().catch(() => undefined);

  return {
    store,
    clock,
    repo,
    profileAuditRepo,
    refresher,
    pvRepo,
    viewsRefresher,
    autopilotRng,
    reportsStore,
    llmHttp,
    gatekeeper,
    windows,
    coordinator,
    effects,
    workerEffects,
    runFinalizer,
    targetDeps,
    supervisor,
    finalizeRun,
    refreshMetricsIfDue,
    keepAlive: () => startWorkerKeepAlive(() => chrome.runtime.getPlatformInfo()),
  };
}

export type WorkerContext = ReturnType<typeof createWorkerContext>;
