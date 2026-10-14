import { randomId } from '@/adapters/randomId';
import { DailyCeiling } from '@lib/autopilot/DailyCeiling';
import { engagementLimit } from '@lib/autopilot/engagementLimit';
import { enabledModules, runLoopModules } from '@lib/autopilot/startGate';
import { resolveDailyBudget } from '@lib/autopilot/resolveDailyBudget';
import { isPausedUntil, localDay, RUN_PAUSE_KEY } from '@lib/autopilot/runPause';
import { COLLECTING_IDEAS, SCANNING } from '@lib/autopilot/statusLabels';
import { bootstrapModuleState } from '@lib/modules/moduleState';
import { loadContentSettings } from '@lib/content/settings';
import { runtimeError, runtimeOk, type StartAutopilotResponse } from '@lib/runtimeProtocol';
import type { AutopilotHost, ModuleOutcome } from '@lib/types';
import { continueAutopilotStart } from './startContinuation';
import { launchAutopilotRun, openFeedLoop } from './runLauncher';
import {
  hasLinkedInHostPermission,
  LINKEDIN_FEED_URL,
  prepareFeedTarget,
  selectLinkedInTarget,
  type TargetTab,
} from './runTarget';
import { readTabMessage } from './linkedinTabBridge';
import type { WorkerContext } from './workerContext';

export interface LaunchSteps {
  runViewsThen: (
    tabId: number,
    runId: string,
    cancelled: () => Promise<boolean>,
  ) => Promise<ModuleOutcome>;
  runAcceptThen: (
    tabId: number,
    runId: string,
    cancelled: () => Promise<boolean>,
  ) => Promise<number>;
  runConnectsThen: (
    tabId: number,
    runId: string,
    afterUrl: string,
    cancelled: () => Promise<boolean>,
  ) => Promise<ModuleOutcome>;
  publishApprovedThen: (
    tabId: number,
    runId: string,
    cancelled: () => Promise<boolean>,
  ) => Promise<ModuleOutcome>;
}

export function createAutopilotStart(ctx: WorkerContext, steps: LaunchSteps) {
  const dayKey = () => ctx.clock.now().toISOString().slice(0, 10);

  function sendRunLoop(
    tabId: number,
    runId: string,
    modules: { engagement: boolean; content: boolean; comments: boolean },
  ) {
    return openFeedLoop({
      runId,
      runLoop: () =>
        readTabMessage(tabId, {
          type: 'AUTOPILOT_RUN_LOOP',
          runId,
          modules,
        }),
      attach: () => readTabMessage(tabId, { type: 'AUTOPILOT_ATTACH', runId }),
    });
  }

  return async function startAutopilot(
    host: AutopilotHost,
    requestId = randomId(),
  ): Promise<StartAutopilotResponse> {
    await ctx.supervisor.reconcile();
    const existing = await ctx.coordinator.getState();
    const modulesState = await bootstrapModuleState(ctx.store);
    if (enabledModules(modulesState).length === 0) {
      return runtimeError('no-modules', 'Enable at least one available module');
    }
    if (isPausedUntil(await ctx.store.get(RUN_PAUSE_KEY), localDay(ctx.clock.now()))) {
      return runtimeError('paused', 'Autopilot is paused until tomorrow');
    }
    if (!(await hasLinkedInHostPermission(ctx.targetDeps))) {
      return runtimeError(
        'missing-host-permission',
        'Allow Lodestar to access https://www.linkedin.com',
        true,
      );
    }

    const prev = existing
      ? { day: existing.day, ceiling: existing.ceiling, used: existing.used }
      : null;
    const budget = resolveDailyBudget(
      prev,
      dayKey(),
      new DailyCeiling({ base: engagementLimit(modulesState) }).forDay(ctx.autopilotRng),
    );
    const begun = await ctx.coordinator.begin({
      requestId,
      host,
      day: budget.day,
      ceiling: budget.ceiling,
      used: budget.used,
    });
    if (begun.kind === 'duplicate') {
      return runtimeOk({
        started: true,
        duplicate: true,
        runId: begun.runId,
        status: await ctx.coordinator.status(),
      });
    }
    if (begun.kind === 'already-running')
      return runtimeError('already-running', 'Another autopilot run is active');
    if (begun.kind === 'recovery-required')
      return runtimeError('recovery-required', 'Interrupted run recovery is required', true);

    const runId = begun.runId;
    const releaseStartClaim = ctx.supervisor.claimLaunch(runId);
    try {
      let target: (TargetTab & { id: number }) | null = null;
      let windowId: number | undefined;
      try {
        if (host === 'window') {
          const created = await ctx.windows.createFeedWindow();
          windowId = created.windowId;
          target = {
            id: created.tabId,
            windowId,
            url: LINKEDIN_FEED_URL,
            status: 'loading',
          };
        } else {
          const selected = await selectLinkedInTarget(ctx.targetDeps);
          if (selected.ok) target = selected.tab;
        }
      } catch {
        target = null;
      }
      if (!target) {
        await ctx.finalizeRun(runId, 'navigation_failed');
        return runtimeError('no-linkedin-tab', 'Could not select or create a LinkedIn tab', true);
      }

      const runTarget = target;
      await ctx.coordinator.setTarget(runId, {
        tabId: runTarget.id,
        windowId,
        expectedUrl: LINKEDIN_FEED_URL,
      });
      const continuation = await continueAutopilotStart(runId, {
        prepareFeed: (scopedRunId) =>
          prepareFeedTarget(ctx.targetDeps, runTarget, scopedRunId, () =>
            ctx.coordinator.isActive(scopedRunId).then((active) => !active),
          ),
        isActive: (scopedRunId) => ctx.coordinator.isActive(scopedRunId),
        prepareLaunch: async () => {
          const baseModules = runLoopModules(modulesState);
          const loopModules = {
            ...baseModules,
            comments:
              baseModules.engagement && (await loadContentSettings(ctx.store)).commentsEnabled,
          };
          const enabledIds = new Set(enabledModules(modulesState).map((module) => module.id));
          const cancelled = async () => !(await ctx.coordinator.isActive(runId));
          return () =>
            launchAutopilotRun(
              runId,
              {
                tabId: runTarget.id,
                enabled: {
                  engagement: enabledIds.has('engagement'),
                  profileViews: enabledIds.has('profile_views'),
                  smartConnect: enabledIds.has('smart_connect'),
                  content: enabledIds.has('content'),
                },
                loopModules,
                labels: { scanning: SCANNING, collecting: COLLECTING_IDEAS },
              },
              {
                coordinator: ctx.coordinator,
                runViews: () => steps.runViewsThen(runTarget.id, runId, cancelled),
                runAccept: () => steps.runAcceptThen(runTarget.id, runId, cancelled),
                runConnect: () =>
                  steps.runConnectsThen(runTarget.id, runId, LINKEDIN_FEED_URL, cancelled),
                runPublishing: () => steps.publishApprovedThen(runTarget.id, runId, cancelled),
                prepareFeed: async (scopedRunId) => {
                  const tab = await ctx.targetDeps.getTab(runTarget.id);
                  return tab && typeof tab.id === 'number'
                    ? prepareFeedTarget(
                        ctx.targetDeps,
                        tab as TargetTab & { id: number },
                        scopedRunId,
                        () => ctx.coordinator.isActive(scopedRunId).then((active) => !active),
                      )
                    : { ok: false, reason: 'navigation_failed' };
                },
                startFeedLoop: (scopedRunId, modules) =>
                  sendRunLoop(runTarget.id, scopedRunId, modules),
                finalize: ctx.finalizeRun,
                startKeepAlive: ctx.keepAlive,
                clearActivity: () =>
                  chrome.tabs
                    .sendMessage(runTarget.id, {
                      type: 'SET_ACTIVITY',
                      active: false,
                    })
                    .catch(() => undefined),
              },
            );
        },
        trackLaunch: (scopedRunId, launch) => {
          ctx.supervisor.trackLaunch(scopedRunId, launch);
        },
        status: () => ctx.coordinator.status(),
      });
      if (continuation.kind === 'preflight-failed') {
        await ctx.finalizeRun(runId, continuation.reason);
        return runtimeError(
          continuation.reason === 'navigation_failed' ? 'navigation-failed' : 'unsupported-dom',
          continuation.reason === 'navigation_failed'
            ? 'LinkedIn feed did not finish loading'
            : 'LinkedIn feed content is unsupported',
          continuation.reason === 'navigation_failed',
        );
      }
      if (continuation.kind === 'stale') {
        return runtimeError('stale-run', 'Autopilot run stopped during startup');
      }
      return runtimeOk({
        started: true,
        duplicate: false,
        runId,
        status: continuation.status,
      });
    } finally {
      releaseStartClaim();
    }
  };
}
