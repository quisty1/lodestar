import { MathRandomRng } from '@/adapters/MathRandomRng';
import { HumanDelay } from '@lib/engagement/HumanDelay';
import { loadConnectSettings } from '@lib/connect/settings';
import { peopleSearchUrl } from '@lib/connect/peopleSearchUrl';
import { geoUrnsForConnect } from '@lib/connect/exclusion';
import { VIEWING_PROFILES } from '@lib/autopilot/statusLabels';
import type { Clock, KeyValueStore } from '@lib/ports';
import type { HarvestResult, ModuleOutcome } from '@lib/types';
import { LINKEDIN_FEED_URL, prepareRunTarget, type RunTargetDependencies } from './runTarget';
import { runViewWithFallback } from './viewHandlers';
import { navigateLinkedInTab, readTabMessage, setStage } from './linkedinTabBridge';
import type { RunCoordinator } from '@lib/autopilot/RunCoordinator';
import type { WorkerEffectClient } from './WorkerEffectClient';
import type { EffectRunFinalizer } from './EffectRunFinalizer';

export interface ViewStepDeps {
  store: KeyValueStore;
  clock: Clock;
  coordinator: RunCoordinator;
  workerEffects: WorkerEffectClient;
  runFinalizer: EffectRunFinalizer;
  targetDeps: RunTargetDependencies;
  contentSleep: (tabId: number, runId: string, ms: number) => Promise<void>;
}

export function createViewStep(deps: ViewStepDeps) {
  const navigate = (tabId: number, url: string, runId?: string) =>
    navigateLinkedInTab(deps.targetDeps, (id) => deps.coordinator.isActive(id), tabId, url, runId);
  const stage = (runId: string, tabId: number | undefined, label: string) =>
    setStage(deps.coordinator, runId, tabId, label);

  async function harvestProfilesPageFrom(tabId: number): Promise<HarvestResult> {
    const response = await readTabMessage(tabId, { type: 'HARVEST_PROFILES_PAGE' });
    return (response as HarvestResult | null) ?? { candidates: [], outcome: 'not_ready' };
  }

  async function harvestPymkProfilesFrom(tabId: number, target: number): Promise<HarvestResult> {
    const response = await readTabMessage(tabId, { type: 'HARVEST_PYMK', target, profiles: true });
    return (response as HarvestResult | null) ?? { candidates: [], outcome: 'not_ready' };
  }

  async function nextPeoplePageFrom(tabId: number): Promise<boolean> {
    const response = await readTabMessage(tabId, { type: 'PEOPLE_NEXT_PAGE' });
    return response === true;
  }

  async function runViewsThen(
    tabId: number,
    runId: string,
    cancelled: () => Promise<boolean>,
  ): Promise<ModuleOutcome> {
    const rng = new MathRandomRng();
    const pacer = new HumanDelay(rng);
    const settings = await loadConnectSettings(deps.store);
    if (await cancelled()) return { executed: 0, skipped: 0, reason: 'cancelled' };
    const searchUrl = settings.searchKeywords.trim()
      ? peopleSearchUrl(
          settings.searchKeywords,
          geoUrnsForConnect(settings.targetRegions, settings.excludeIndia),
        )
      : null;
    let currentUrl = LINKEDIN_FEED_URL;
    const res = await runViewWithFallback({
      store: deps.store,
      clock: deps.clock,
      rng,
      cancelled,
      navigate: async (url) => {
        if (await cancelled()) return false;
        const ok = await navigate(tabId, url, runId);
        if (!ok || (await cancelled())) return false;
        currentUrl = url;
        await stage(runId, tabId, VIEWING_PROFILES);
        return !(await cancelled());
      },
      dwell: async () => {
        await readTabMessage(tabId, {
          type: 'DWELL_PROFILE',
          runId,
          expectedUrl: currentUrl,
        });
        return undefined;
      },
      view: async (candidate) => {
        const observation = await deps.workerEffects.execute(
          runId,
          `${runId}:profile-view:${candidate.memberId}`,
          {
            kind: 'profile_view',
            targetKey: candidate.memberId,
            person: { ...candidate },
          },
          async (gate) => {
            if (await cancelled()) return { outcome: 'cancelled', reason: 'run-inactive' };
            if (!(await gate.commit())) return { outcome: 'failed', reason: 'commit_rejected' };
            const prepared = await prepareRunTarget(
              deps.targetDeps,
              tabId,
              candidate.profileUrl,
              runId,
              () => false,
            );
            if (!prepared.ok) return { outcome: 'uncertain', reason: 'navigation_failed' };
            currentUrl = candidate.profileUrl;
            await stage(runId, tabId, VIEWING_PROFILES);
            await readTabMessage(tabId, {
              type: 'DWELL_PROFILE',
              runId,
              expectedUrl: candidate.profileUrl,
              committed: true,
            });
            if (!(await deps.coordinator.isActive(runId))) {
              await readTabMessage(tabId, { type: 'STOP_AUTOPILOT', runId });
            }
            return { outcome: 'confirmed' };
          },
        );
        if (observation.reserved && observation.settled !== true) {
          await deps.runFinalizer.request(runId, 'error');
          return { ok: false, reason: 'effect_unsettled', safetySpent: true };
        }
        return {
          ok: observation.outcome === 'confirmed',
          safetySpent: observation.outcome === 'confirmed' || observation.outcome === 'uncertain',
          reason: observation.reason,
        };
      },
      pace: () => deps.contentSleep(tabId, runId, pacer.nextMs(8000, 30000)),
      searchUrl,
      searchHarvestPage: () => harvestProfilesPageFrom(tabId),
      searchNextPage: () => nextPeoplePageFrom(tabId),
      pymkHarvestPage: () => harvestPymkProfilesFrom(tabId, 40),
    });
    if (await cancelled())
      return {
        executed: res.executed,
        skipped: res.skipped,
        reason: 'cancelled',
      };
    if (!(await navigate(tabId, LINKEDIN_FEED_URL, runId))) {
      return {
        executed: res.executed,
        skipped: res.skipped,
        reason: 'navigation_failed',
      };
    }
    return { executed: res.executed, skipped: res.skipped, reason: res.reason };
  }

  return { runViewsThen };
}
