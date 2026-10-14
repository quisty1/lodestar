import { MathRandomRng } from '@/adapters/MathRandomRng';
import { HumanDelay } from '@lib/engagement/HumanDelay';
import { ACCEPTING, CONNECTING, PUBLISHING, SEARCHING_PEOPLE } from '@lib/autopilot/statusLabels';
import type { Clock, KeyValueStore } from '@lib/ports';
import type { HarvestResult, ModuleOutcome } from '@lib/types';
import type { RunCoordinator } from '@lib/autopilot/RunCoordinator';
import * as content from './contentHandlers';
import { NavigationFailedError } from './runLauncher';
import { LINKEDIN_FEED_URL, type RunTargetDependencies } from './runTarget';
import { runConnectWithFallback } from './connectHandlers';
import { navigateLinkedInTab, readTabMessage, setStage } from './linkedinTabBridge';
import type { WorkerEffectClient } from './WorkerEffectClient';
import type { EffectRunFinalizer } from './EffectRunFinalizer';

const RECEIVED_URL = 'https://www.linkedin.com/mynetwork/invitation-manager/received/';

export interface ModuleStepDeps {
  store: KeyValueStore;
  clock: Clock;
  coordinator: RunCoordinator;
  workerEffects: WorkerEffectClient;
  runFinalizer: EffectRunFinalizer;
  targetDeps: RunTargetDependencies;
}

export function createModuleSteps(deps: ModuleStepDeps) {
  const navigate = (tabId: number, url: string, runId?: string) =>
    navigateLinkedInTab(deps.targetDeps, (id) => deps.coordinator.isActive(id), tabId, url, runId);
  const stage = (runId: string, tabId: number | undefined, label: string) =>
    setStage(deps.coordinator, runId, tabId, label);

  async function contentSleep(tabId: number, runId: string, ms: number): Promise<void> {
    await chrome.tabs.sendMessage(tabId, { type: 'SLEEP', runId, ms }).catch(() => {});
  }

  async function harvestPeoplePageFrom(tabId: number): Promise<HarvestResult> {
    const response = await readTabMessage(tabId, { type: 'HARVEST_PEOPLE_PAGE' });
    return (response as HarvestResult | null) ?? { candidates: [], outcome: 'not_ready' };
  }

  async function harvestPymkFrom(tabId: number, target: number): Promise<HarvestResult> {
    const response = await readTabMessage(tabId, { type: 'HARVEST_PYMK', target });
    return (response as HarvestResult | null) ?? { candidates: [], outcome: 'not_ready' };
  }

  async function nextPeoplePageFrom(tabId: number): Promise<boolean> {
    const response = await readTabMessage(tabId, { type: 'PEOPLE_NEXT_PAGE' });
    return response === true;
  }

  async function runAcceptThen(
    tabId: number,
    runId: string,
    cancelled: () => Promise<boolean>,
  ): Promise<number> {
    if (await cancelled()) return 0;
    if (!(await navigate(tabId, RECEIVED_URL, runId))) throw new NavigationFailedError();
    if (await cancelled()) return 0;
    await stage(runId, tabId, ACCEPTING);
    if (await cancelled()) return 0;
    const response = await readTabMessage(tabId, { type: 'ACCEPT_INCOMING', runId, cap: 15 });
    return (response as { accepted?: number } | null)?.accepted ?? 0;
  }

  async function runConnectsThen(
    tabId: number,
    runId: string,
    afterUrl: string,
    cancelled: () => Promise<boolean>,
  ): Promise<ModuleOutcome> {
    const rng = new MathRandomRng();
    const pacer = new HumanDelay(rng);
    const res = await runConnectWithFallback({
      store: deps.store,
      clock: deps.clock,
      rng,
      navigate: async (url) => {
        if (await cancelled()) return false;
        const ok = await navigate(tabId, url, runId);
        if (!ok || (await cancelled())) return false;
        await stage(runId, tabId, SEARCHING_PEOPLE);
        return !(await cancelled());
      },
      harvest: () => harvestPeoplePageFrom(tabId),
      nextPage: () => nextPeoplePageFrom(tabId),
      pymkHarvest: () => harvestPymkFrom(tabId, 30),
      connect: async (candidate) => {
        if (await cancelled()) return { ok: false, reason: 'cancelled' };
        await stage(runId, tabId, CONNECTING);
        if (await cancelled()) return { ok: false, reason: 'cancelled' };
        const reservation = await deps.workerEffects.reserve(
          runId,
          `${runId}:connect:${candidate.memberId}`,
          { kind: 'connect', targetKey: candidate.memberId, person: { ...candidate } },
        );
        if (reservation.kind !== 'ready') return { ok: false, reason: reservation.reason };
        const response = (await chrome.tabs
          .sendMessage(tabId, {
            type: 'EXECUTE_ACTION',
            runId,
            effect: reservation.token,
            action: {
              type: 'connect',
              target: {
                url: candidate.profileUrl,
                meta: { memberId: candidate.memberId, name: candidate.name },
              },
            },
          })
          .catch(() => undefined)) as
          { ok?: boolean; reason?: string; safetySpent?: boolean } | undefined;
        if (response === undefined || response.reason === 'effect_unsettled') {
          await deps.runFinalizer.request(runId, 'error');
          return undefined;
        }
        return {
          ok: response.ok === true,
          reason: response.reason,
          safetySpent: response.safetySpent === true,
        };
      },
      pace: () => contentSleep(tabId, runId, pacer.nextMs(8000, 30000)),
      cancelled,
    });
    if (await cancelled())
      return {
        executed: res.executed,
        skipped: res.skipped,
        reason: 'cancelled',
      };
    if (!(await navigate(tabId, afterUrl, runId))) {
      return {
        executed: res.executed,
        skipped: res.skipped,
        reason: 'navigation_failed',
      };
    }
    return { executed: res.executed, skipped: res.skipped, reason: res.reason };
  }

  async function publishApprovedThen(
    tabId: number,
    runId: string,
    cancelled: () => Promise<boolean>,
  ): Promise<ModuleOutcome> {
    const res = await content.publishApprovedDrafts({
      store: deps.store,
      clock: deps.clock,
      cancelled,
      prepare: async () => {
        if (await cancelled()) return;
        if (!(await navigate(tabId, LINKEDIN_FEED_URL, runId))) throw new NavigationFailedError();
        if (await cancelled()) return;
        await stage(runId, tabId, PUBLISHING);
      },
      publish: async (text, draft) => {
        if (await cancelled()) return { ok: false, reason: 'cancelled' };
        const reservation = await deps.workerEffects.reserve(
          runId,
          `${runId}:publish:${draft.id}`,
          { kind: 'publish', targetKey: draft.id, draftId: draft.id },
        );
        if (reservation.kind !== 'ready') return { ok: false, reason: reservation.reason };
        const response = (await chrome.tabs
          .sendMessage(tabId, {
            type: 'EXECUTE_ACTION',
            runId,
            effect: reservation.token,
            action: {
              type: 'post',
              target: {
                url: 'https://www.linkedin.com/feed/',
                meta: { draftId: draft.id },
              },
              payload: { post: text },
            },
          })
          .catch(() => undefined)) as
          { ok?: boolean; reason?: string; safetySpent?: boolean } | undefined;
        if (response === undefined || response.reason === 'effect_unsettled') {
          await deps.runFinalizer.request(runId, 'error');
          return undefined;
        }
        return {
          ok: response.ok === true,
          reason: response.reason,
          safetySpent: response.safetySpent === true,
        };
      },
    });
    return { executed: res.published, reason: res.reason ?? 'done' };
  }

  return { runAcceptThen, runConnectsThen, publishApprovedThen, contentSleep };
}
