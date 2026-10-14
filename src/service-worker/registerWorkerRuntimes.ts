import { GENERATING_IDEAS } from '@lib/autopilot/statusLabels';
import {
  runtimeError,
  runtimeOk,
  type GetAutopilotStatusResponse,
  type StopAutopilotResponse,
} from '@lib/runtimeProtocol';
import * as content from './contentHandlers';
import { createEffectRuntimeHandlers } from './effectRuntimeHandlers';
import { registerExtensionStartup } from './extensionStartup';
import { registerModelCatalogRuntime } from './modelCatalogRuntime';
import { registerModuleStateBootstrap } from './moduleStateLifecycle';
import { prepareProfileAuditTarget } from './profileAuditTarget';
import { registerProfileAuditRuntime, runProfileAudit } from './profileAuditRuntime';
import { registerAutopilotRuntime } from './autopilotRuntime';
import { permitsFinishedIdeaCatchup, registerRunContentRuntime } from './runContentRuntime';
import { registerRunRecoveryLifecycle } from './runLifecycle';
import { registerSsiRefreshRuntime } from './ssiRefreshRuntime';
import { broadcast, setStage } from './linkedinTabBridge';
import type { WorkerContext } from './workerContext';
import type { createAutopilotStart } from './autopilotStart';

type StartAutopilot = ReturnType<typeof createAutopilotStart>;

export function registerWorkerRuntimes(ctx: WorkerContext, startAutopilot: StartAutopilot): void {
  registerExtensionStartup(chrome);
  registerModuleStateBootstrap(chrome.runtime.onInstalled, ctx.store);
  registerAutopilotRuntime(chrome.runtime.onMessage, {
    status: async (): Promise<GetAutopilotStatusResponse> => {
      await ctx.supervisor.reconcile();
      return runtimeOk(await ctx.coordinator.status());
    },
    start: startAutopilot,
    stop: async (requestedRunId?: string): Promise<StopAutopilotResponse> => {
      await ctx.supervisor.reconcile();
      const state = await ctx.coordinator.getState();
      const runId = requestedRunId ?? state?.runId;
      if (!runId)
        return runtimeOk({
          stopped: false,
          runId: '',
          status: await ctx.coordinator.status(),
        });
      if (requestedRunId && state?.runId !== requestedRunId) {
        return runtimeError('stale-run', 'The requested run is no longer active');
      }
      const active = await ctx.coordinator.isActive(runId);
      if (active) await ctx.runFinalizer.request(runId, 'manual');
      return runtimeOk({
        stopped: active,
        runId,
        status: await ctx.coordinator.status(),
      });
    },
    mayAct: async (runId) => {
      const state = await ctx.coordinator.getState();
      if (!state || state.runId !== runId || !(await ctx.coordinator.isActive(runId))) {
        return { action: 'stop', reason: 'manual' };
      }
      const decision = ctx.gatekeeper.decide({
        used: state.used,
        ceiling: state.ceiling,
        manualStop: state.manualStop,
        risk: state.riskMarkers ?? [],
        actionTimestamps: state.actionTimestamps,
        now: ctx.clock.now().getTime(),
      });
      if (decision.action === 'stop') await ctx.finalizeRun(runId, decision.reason);
      return decision;
    },
    risk: async (runId, marker) => (await ctx.coordinator.recordRisk(runId, marker)) !== null,
    ended: async (runId, reason) => {
      if (!(await ctx.coordinator.isActive(runId))) return false;
      await ctx.runFinalizer.request(runId, reason);
      return true;
    },
    ...createEffectRuntimeHandlers({
      coordinator: ctx.coordinator,
      effects: ctx.effects,
      onSettled: (runId) => {
        void ctx.coordinator.getState().then((state) => {
          if (
            state?.runId === runId &&
            (state.phase === 'stopping' || state.phase === 'finalizing')
          ) {
            void ctx.runFinalizer.finish(runId, state);
          }
        });
      },
    }),
  });

  registerRunContentRuntime(chrome.runtime.onMessage, {
    isActive: (runId) => ctx.coordinator.isActive(runId),
    canExtract: async (runId) =>
      (await ctx.coordinator.isActive(runId)) ||
      permitsFinishedIdeaCatchup(await ctx.coordinator.getState(), runId),
    showIdeaActivity: async (runId) => {
      const state = await ctx.coordinator.getState();
      if (state?.runId === runId)
        await setStage(ctx.coordinator, runId, state.tabId, GENERATING_IDEAS);
    },
    hideIdeaActivity: async (runId) => {
      const state = await ctx.coordinator.getState();
      if (state?.runId === runId && state.tabId && (await ctx.coordinator.isActive(runId))) {
        await chrome.tabs
          .sendMessage(state.tabId, { type: 'SET_ACTIVITY', active: false })
          .catch(() => undefined);
      }
    },
    extract: (_runId, posts, cancelled) =>
      content.extractRunIdeas(
        { store: ctx.store, http: ctx.llmHttp, clock: ctx.clock, cancelled },
        posts,
      ),
    comment: (_runId, post, cancelled) =>
      content.commentOnPost(
        { store: ctx.store, http: ctx.llmHttp, clock: ctx.clock, cancelled },
        post,
      ),
  });

  registerSsiRefreshRuntime(chrome.runtime.onMessage, {
    refreshSsi: () => ctx.refresher.refreshNow(),
    saveSsi: (snapshot) => ctx.repo.save(snapshot),
    broadcastSsi: (snapshot) => {
      broadcast({ type: 'SSI_SNAPSHOT', payload: snapshot });
    },
    refreshProfileViews: () => ctx.viewsRefresher.refreshNow(),
    saveProfileViews: (snapshot) => ctx.pvRepo.save(snapshot),
    broadcastProfileViews: (snapshot) => {
      broadcast({ type: 'PROFILE_VIEWS_SNAPSHOT', payload: snapshot });
    },
    onError: (scope, error) => {
      console.error(`[Lodestar] ${scope} refresh failed`, error);
    },
  });

  registerModelCatalogRuntime(chrome.runtime.onMessage, (provider, apiKey) =>
    content.listModels(ctx.llmHttp, provider, apiKey),
  );

  registerProfileAuditRuntime(chrome.runtime.onMessage, {
    start: (requestId) =>
      runProfileAudit(requestId, {
        prepare: () => prepareProfileAuditTarget(ctx.targetDeps),
        read: (tabId, scopedRequestId) =>
          ctx.targetDeps.sendMessage(tabId, {
            type: 'READ_PROFILE_AUDIT',
            requestId: scopedRequestId,
          }),
        save: (result) => ctx.profileAuditRepo.save(result),
        now: () => ctx.clock.now(),
      }),
  });

  registerRunRecoveryLifecycle(chrome, {
    recover: () => ctx.supervisor.reconcile(),
    tabRemoved: (tabId) => ctx.supervisor.onTabRemoved(tabId),
    tabUpdated: (tabId, change) => ctx.supervisor.onTabUpdated(tabId, change),
    windowRemoved: async (closedId) => {
      const state = await ctx.coordinator.getState();
      if (state?.running && state.host === 'window' && state.windowId === closedId && state.runId) {
        await ctx.finalizeRun(state.runId, 'manual');
      }
    },
  });
}
