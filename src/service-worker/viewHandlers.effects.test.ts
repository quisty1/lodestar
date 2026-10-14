import { describe, expect, it, vi } from 'vitest';
import { EffectAccountant } from '@lib/autopilot/EffectAccountant';
import { EffectService } from '@lib/autopilot/EffectService';
import { RunCoordinator } from '@lib/autopilot/RunCoordinator';
import { RunReportStore } from '@lib/autopilot/RunReportStore';
import { FakeStore } from '@lib/storage/fakeStore';
import { VIEW_DAY_BUDGET_KEY, VIEW_SEEN_KEY } from '@lib/views/ViewDayBudget';
import { WorkerEffectClient } from './WorkerEffectClient';
import { prepareRunTarget, type RunTargetDependencies } from './runTarget';
import { runViewWithFallback } from './viewHandlers';
import { contentPong } from './contentPong.test-fixture';

describe('runViewWithFallback durable effect boundary', () => {
  it('settles an exact loaded profile even when the best-effort dwell response is lost', async () => {
    const store = new FakeStore();
    await store.set('modules:state', [{ id: 'profile_views', enabled: true, dailyLimit: 1 }]);
    const clock = { now: () => new Date('2026-08-11T10:00:00.000Z') };
    const reports = new RunReportStore(store);
    const coordinator = new RunCoordinator({
      store,
      clock,
      reports,
      createId: () => 'run-1',
    });
    const begun = await coordinator.begin({
      requestId: 'start-1',
      host: 'tab',
      day: '2026-08-11',
      ceiling: 10,
      used: 0,
    });
    if (begun.kind !== 'started') throw new Error(begun.kind);
    const effects = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock,
    });
    const worker = new WorkerEffectClient({
      coordinator,
      effects,
      createId: () => 'attempt-1',
    });
    const candidate = {
      memberId: 'member-1',
      name: 'Ada',
      headline: 'CTO',
      profileUrl: 'https://www.linkedin.com/in/ada/',
    };
    const edge: string[] = [];
    const dwell = vi.fn(async () => ({ ok: true }));
    const dwellDelivery = vi.fn(async () => undefined);
    let profileUrl = 'https://www.linkedin.com/feed/';
    const profileTarget: RunTargetDependencies = {
      hasHostPermission: async () => true,
      queryTabs: async () => [],
      createTab: async (url) => ({ id: 7, url, status: 'complete' }),
      updateTab: async (id, url) => {
        profileUrl = url;
        return { id, url, status: 'complete' };
      },
      getTab: async (id) => ({ id, url: profileUrl, status: 'complete' }),
      sendMessage: async (_id, message) =>
        (message as { type?: string }).type === 'AUTOPILOT_ATTACH'
          ? { ok: true, runId: begun.runId, duplicate: false }
          : contentPong({
              url: profileUrl,
              surface: 'profile',
              capabilities: { feed: 'absent', like: 'absent', comment: 'absent', profile: 'ready' },
            }),
      reloadTab: async () => undefined,
      injectContentScript: async () => true,
      sleep: async () => undefined,
      maxAttempts: 1,
    };

    const result = await runViewWithFallback({
      store,
      clock,
      rng: { next: () => 1 },
      searchUrl: null,
      navigate: vi.fn(async () => true),
      dwell,
      pace: async () => undefined,
      cancelled: async () => false,
      searchHarvestPage: async () => ({ candidates: [], outcome: 'empty' }),
      searchNextPage: async () => false,
      pymkHarvestPage: async () => ({ candidates: [candidate], outcome: 'ok' }),
      view: async (person) => {
        const observation = await worker.execute(
          begun.runId,
          `${begun.runId}:profile-view:${person.memberId}`,
          { kind: 'profile_view', targetKey: person.memberId, person },
          async ({ commit }) => {
            if (!(await commit())) return { outcome: 'failed', reason: 'commit_rejected' };
            const prepared = await prepareRunTarget(
              profileTarget,
              7,
              person.profileUrl,
              begun.runId,
              () => false,
            );
            if (!prepared.ok) return { outcome: 'uncertain', reason: 'navigation_failed' };
            edge.push('navigate-profile');
            await dwellDelivery();
            return { outcome: 'confirmed' };
          },
        );
        return { ok: observation.outcome === 'confirmed', reason: observation.reason };
      },
    });

    expect(result).toMatchObject({ executed: 1, reason: 'done' });
    expect(edge).toEqual(['navigate-profile']);
    expect(dwellDelivery).toHaveBeenCalledOnce();
    expect(dwell).not.toHaveBeenCalled();
    const receipts = Object.values((await coordinator.getState())?.effectLedger?.receipts ?? {});
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ outcome: 'confirmed', accounting: 'applied' });
    expect(await store.get(VIEW_DAY_BUDGET_KEY)).toMatchObject({ used: 1 });
    expect(await store.get(VIEW_SEEN_KEY)).toEqual(['member-1']);
  });
});
