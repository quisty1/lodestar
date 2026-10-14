import { describe, it, expect, vi } from 'vitest';
import { runViewStep, runViewWithFallback } from './viewHandlers';
import { prepareRunTarget, type RunTargetDependencies } from './runTarget';
import { contentPong } from './contentPong.test-fixture';
import { VIEW_DAY_BUDGET_KEY, VIEW_SEEN_KEY } from '../lib/views/ViewDayBudget';
import { VIEW_HISTORY_KEY } from '../lib/views/ViewHistory';
import type { HarvestResult, PersonCandidate } from '../lib/types';

function fakeStore(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    data,
    get: async <T>(k: string) => (k in data ? (data[k] as T) : null),
    set: async <T>(k: string, v: T) => {
      data[k] = v;
    },
  };
}
const clock = { now: () => new Date('2026-06-26T10:00:00Z') };
const rng = { next: () => 1 }; // no down-jitter
const people: PersonCandidate[] = [
  { memberId: 'a', name: 'A', headline: 'Recruiter', profileUrl: 'https://l/in/a' },
  { memberId: 'b', name: 'B', headline: 'Eng', profileUrl: 'https://l/in/b' },
];
const ok = (candidates: PersonCandidate[]): HarvestResult => ({ candidates, outcome: 'ok' });
const enabled = { 'modules:state': [{ id: 'profile_views', enabled: true, dailyLimit: 40 }] };

const baseDeps = (store: ReturnType<typeof fakeStore>) => ({
  store,
  clock,
  rng,
  searchUrl: 'https://l/search/people',
  navigate: async () => true,
  harvestPage: async () => ok(people), // one page; nextPage:false ⇒ no pagination
  nextPage: async () => false,
  dwell: async () => ({ ok: true }),
  pace: async () => {},
  cancelled: async () => false,
});

describe('runViewStep', () => {
  it('skips when profile_views disabled', async () => {
    const store = fakeStore({
      'modules:state': [{ id: 'profile_views', enabled: false, dailyLimit: 40 }],
    });
    const res = await runViewStep(baseDeps(store));
    expect(res).toEqual({ executed: 0, skipped: 0, reason: 'disabled' });
  });

  it('views fresh profiles and leaves history/counters to effect receipts', async () => {
    const store = fakeStore(enabled);
    const res = await runViewStep(baseDeps(store));
    expect(res.executed).toBe(2);
    // only 2 fresh exist but the cap is 40 → honest "pool ran dry below the cap"
    expect(res.reason).toBe('pool_dry');
    expect(store.data[VIEW_HISTORY_KEY]).toBeUndefined();
    expect(store.data[VIEW_DAY_BUDGET_KEY]).toBeUndefined();
    expect(store.data[VIEW_SEEN_KEY]).toBeUndefined();
  });

  it('dedups already-seen profiles', async () => {
    const store = fakeStore({ ...enabled, [VIEW_SEEN_KEY]: ['a'] });
    const res = await runViewStep(baseDeps(store));
    expect(res.executed).toBe(1); // only 'b' is fresh
  });

  it('pages past an all-seen page to fill the cap with FRESH profiles', async () => {
    const store = fakeStore({
      'modules:state': [{ id: 'profile_views', enabled: true, dailyLimit: 2 }],
      [VIEW_SEEN_KEY]: ['a', 'b'],
    });
    const pages: HarvestResult[] = [
      ok(people), // page0: a,b — both already seen
      ok([
        { memberId: 'c', name: 'C', headline: '', profileUrl: 'https://l/in/c' },
        { memberId: 'd', name: 'D', headline: '', profileUrl: 'https://l/in/d' },
      ]),
    ];
    let p = 0;
    let nexts = 0;
    const res = await runViewStep({
      ...baseDeps(store),
      harvestPage: async () => pages[p],
      nextPage: async () => {
        nexts++;
        p++;
        return p < pages.length;
      },
    });
    expect(res.executed).toBe(2); // viewed c + d (fresh on page1), not a/b (seen on page0)
    expect(nexts).toBeGreaterThanOrEqual(1); // advanced past the all-seen first page
    expect(res.reason).toBe('done'); // filled the cap of 2 fresh
  });

  it('honors a near-exhausted daily budget', async () => {
    const store = fakeStore({ ...enabled, [VIEW_DAY_BUDGET_KEY]: { day: '2026-06-26', used: 39 } });
    const res = await runViewStep(baseDeps(store));
    expect(res.executed).toBe(1); // only 1 left today
  });

  it('persists NOTHING when every dwell fails (persist-only-on-success)', async () => {
    const store = fakeStore(enabled);
    const res = await runViewStep({ ...baseDeps(store), dwell: async () => ({ ok: false }) });
    expect(res).toMatchObject({ executed: 0, skipped: 2 });
    expect(store.data[VIEW_HISTORY_KEY]).toBeUndefined();
    expect(store.data[VIEW_DAY_BUDGET_KEY]).toBeUndefined();
    expect(store.data[VIEW_SEEN_KEY]).toBeUndefined();
  });

  it('reports nav_failed when the search page never confirmed loaded', async () => {
    const store = fakeStore(enabled);
    const res = await runViewStep({ ...baseDeps(store), navigate: async () => false });
    expect(res).toMatchObject({ executed: 0, reason: 'nav_failed' });
  });

  it('delegates the irreversible profile navigation to the effectful view boundary', async () => {
    const store = fakeStore(enabled);
    const navigate = vi.fn(async () => true);
    const dwell = vi.fn(async () => ({ ok: true }));
    const view = vi.fn(async () => ({ ok: true }));

    const result = await runViewStep({ ...baseDeps(store), navigate, dwell, view });

    expect(result.executed).toBe(2);
    expect(navigate).toHaveBeenCalledTimes(1); // search page only; profile navigation is inside view()
    expect(view).toHaveBeenCalledTimes(2);
    expect(dwell).not.toHaveBeenCalled();
  });

  it('spends the local safety cap on an uncertain view without reporting it executed', async () => {
    const store = fakeStore({
      'modules:state': [{ id: 'profile_views', enabled: true, dailyLimit: 1 }],
    });
    const view = vi.fn(async () => ({
      ok: false,
      safetySpent: true,
      reason: 'navigation_confirmation_timeout',
    }));

    const result = await runViewStep({ ...baseDeps(store), view });

    expect(view).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      executed: 0,
      reason: 'navigation_confirmation_timeout',
      capReached: true,
    });
  });

  it('does not dwell or record a profile whose candidate navigation failed', async () => {
    const store = fakeStore(enabled);
    const dwell = vi.fn(async () => ({ ok: true }));
    let navigations = 0;
    const res = await runViewStep({
      ...baseDeps(store),
      navigate: async () => ++navigations === 1,
      dwell,
    });

    expect(res).toMatchObject({ executed: 0, reason: 'nav_failed' });
    expect(dwell).not.toHaveBeenCalled();
    expect(store.data[VIEW_HISTORY_KEY]).toBeUndefined();
    expect(store.data[VIEW_DAY_BUDGET_KEY]).toBeUndefined();
  });

  it('does not dwell, record history, or spend budget after a wrong-profile PONG', async () => {
    const store = fakeStore(enabled);
    const dwell = vi.fn(async () => ({ ok: true }));
    const profile = {
      memberId: 'alice',
      name: 'Alice',
      headline: 'Engineer',
      profileUrl: 'https://www.linkedin.com/in/alice',
    };
    let requestedUrl = 'https://www.linkedin.com/feed/';
    const pingedUrls: string[] = [];
    const harvestPage = vi.fn(async () => ok([profile]));
    const targetDependencies: RunTargetDependencies = {
      hasHostPermission: async () => true,
      queryTabs: async () => [],
      createTab: async (url) => ({ id: 7, url, status: 'complete' }),
      updateTab: async (id, url) => {
        requestedUrl = url;
        return { id, url, status: 'complete' };
      },
      getTab: async (id) => ({ id, url: requestedUrl, status: 'complete' }),
      sendMessage: async (_id, message) => {
        if ((message as { type?: string }).type !== 'PING') {
          return { ok: true, runId: 'run-1', duplicate: false };
        }
        pingedUrls.push(requestedUrl);
        return contentPong({
          url: requestedUrl.includes('/in/alice')
            ? 'https://www.linkedin.com/in/different-person'
            : requestedUrl,
          surface: 'profile',
          capabilities: { feed: 'absent', like: 'absent', comment: 'absent', profile: 'ready' },
        });
      },
      reloadTab: async () => undefined,
      injectContentScript: async () => true,
      sleep: async () => undefined,
      maxAttempts: 1,
    };
    const navigate = async (url: string) =>
      (await prepareRunTarget(targetDependencies, 7, url, 'run-1')).ok;

    const result = await runViewStep({
      ...baseDeps(store),
      searchUrl: 'https://www.linkedin.com/search/results/people/?keywords=vue',
      navigate,
      harvestPage,
      dwell,
    });

    expect(result).toMatchObject({ executed: 0, reason: 'nav_failed' });
    expect(harvestPage).toHaveBeenCalledOnce();
    expect(pingedUrls.some((url) => url.includes('/in/alice'))).toBe(true);
    expect(dwell).not.toHaveBeenCalled();
    expect(store.data[VIEW_HISTORY_KEY]).toBeUndefined();
    expect(store.data[VIEW_DAY_BUDGET_KEY]).toBeUndefined();
    expect(store.data[VIEW_SEEN_KEY]).toBeUndefined();
  });

  it('starts no harvest after STOP lands during search navigation', async () => {
    const store = fakeStore(enabled);
    let stopped = false;
    const harvestPage = vi.fn(async () => ok(people));
    const res = await runViewStep({
      ...baseDeps(store),
      navigate: async () => {
        stopped = true;
        return true;
      },
      cancelled: async () => stopped,
      harvestPage,
    });

    expect(res).toEqual({ executed: 0, skipped: 0, reason: 'cancelled' });
    expect(harvestPage).not.toHaveBeenCalled();
  });

  it('reports empty_search when the people-search rendered zero results', async () => {
    const store = fakeStore(enabled);
    const res = await runViewStep({
      ...baseDeps(store),
      harvestPage: async () => ({ candidates: [], outcome: 'empty' }),
    });
    expect(res).toMatchObject({ executed: 0, reason: 'empty_search' });
  });

  it('reports not_ready when the search page never rendered its cards', async () => {
    const store = fakeStore(enabled);
    const res = await runViewStep({
      ...baseDeps(store),
      harvestPage: async () => ({ candidates: [], outcome: 'not_ready' }),
    });
    expect(res).toMatchObject({ executed: 0, reason: 'not_ready' });
  });

  it('reports none_fresh when everyone harvested was already seen', async () => {
    const store = fakeStore({ ...enabled, [VIEW_SEEN_KEY]: ['a', 'b'] });
    const res = await runViewStep(baseDeps(store));
    expect(res).toMatchObject({ executed: 0, reason: 'none_fresh' });
  });

  it('STOPS mid-loop when the run is cancelled (views one profile, then aborts)', async () => {
    const store = fakeStore(enabled);
    let dwells = 0;
    const res = await runViewStep({
      ...baseDeps(store),
      dwell: async () => {
        dwells++;
        return { ok: true };
      },
      cancelled: async () => dwells >= 1, // stop after the first view
    });
    expect(res.executed).toBe(1); // viewed 'a', then aborted — did NOT view 'b'
    expect(res.reason).toBe('cancelled');
  });

  it('paces after a successful view', async () => {
    const store = fakeStore(enabled);
    const pace = vi.fn(async () => {});
    const res = await runViewStep({ ...baseDeps(store), pace });
    expect(res.executed).toBe(2);
    expect(pace).toHaveBeenCalledTimes(2);
  });

  it('does NOT pace after a failed dwell (only real views get the anti-ban wait)', async () => {
    const store = fakeStore(enabled);
    const pace = vi.fn(async () => {});
    await runViewStep({ ...baseDeps(store), dwell: async () => ({ ok: false }), pace });
    expect(pace).not.toHaveBeenCalled();
  });
});

describe('runViewWithFallback', () => {
  const dry = async (): Promise<HarvestResult> => ({ candidates: [], outcome: 'empty' });
  const cand = (id: string): PersonCandidate => ({
    memberId: id,
    name: id,
    headline: '',
    profileUrl: `/in/${id}`,
  });
  // Enough fresh candidates in ONE page to fill the (unjittered) cap of 40 → reason 'done'.
  const manyFresh: PersonCandidate[] = Array.from({ length: 45 }, (_, i) => cand(`m${i}`));

  const fallback = (store: ReturnType<typeof fakeStore>, over: Record<string, unknown> = {}) => {
    const b = baseDeps(store);
    return {
      store,
      clock,
      rng,
      navigate: b.navigate,
      dwell: b.dwell,
      pace: b.pace,
      cancelled: b.cancelled,
      searchUrl: b.searchUrl,
      searchHarvestPage: b.harvestPage,
      searchNextPage: b.nextPage,
      pymkHarvestPage: dry,
      ...over,
    };
  };

  it('tops up from PYMK when the search pass under-delivered (pool_dry)', async () => {
    const store = fakeStore(enabled);
    const pymkHarvestPage = vi.fn(async () => ok([cand('7'), cand('8')]));
    const res = await runViewWithFallback(fallback(store, { pymkHarvestPage }));
    expect(pymkHarvestPage).toHaveBeenCalled();
    expect(res.executed).toBe(4); // 2 from search (pool_dry) + 2 from the PYMK top-up
  });

  it('shares one safety cap across uncertain search views and the PYMK fallback', async () => {
    const store = fakeStore({
      'modules:state': [{ id: 'profile_views', enabled: true, dailyLimit: 3 }],
    });
    const view = vi.fn(async () => ({
      ok: false,
      safetySpent: true,
      reason: 'navigation_confirmation_timeout',
    }));
    const pymkHarvestPage = vi.fn(async () => ok(['7', '8', '9', '10', '11'].map(cand)));

    const res = await runViewWithFallback(fallback(store, { view, pymkHarvestPage }));

    expect(view).toHaveBeenCalledTimes(3);
    expect(res).toMatchObject({ executed: 0, safetySpent: 3, capReached: true });
  });

  it('tops up after a full search selection contains a pre-commit failure', async () => {
    const store = fakeStore({
      'modules:state': [{ id: 'profile_views', enabled: true, dailyLimit: 3 }],
    });
    const searchPeople = ['s1', 's2', 's3'].map(cand);
    const view = vi.fn(async (candidate: PersonCandidate) =>
      candidate.memberId === 's3' ? { ok: false, reason: 'commit_rejected' } : { ok: true },
    );
    const pymkHarvestPage = vi.fn(async () => ok(['p1', 'p2'].map(cand)));

    const res = await runViewWithFallback(
      fallback(store, {
        view,
        searchHarvestPage: async () => ok(searchPeople),
        pymkHarvestPage,
      }),
    );

    expect(pymkHarvestPage).toHaveBeenCalledOnce();
    expect(view).toHaveBeenCalledTimes(4);
    expect(res).toMatchObject({ executed: 3, safetySpent: 3, capReached: true });
  });

  it('does NOT run PYMK when the search pass filled the cap (reason done)', async () => {
    const store = fakeStore(enabled);
    const pymkHarvestPage = vi.fn(dry);
    const res = await runViewWithFallback(
      fallback(store, { searchHarvestPage: async () => ok(manyFresh), pymkHarvestPage }),
    );
    expect(pymkHarvestPage).not.toHaveBeenCalled();
    expect(res.reason).toBe('done');
  });

  it('does NOT run PYMK when disabled', async () => {
    const store = fakeStore({
      'modules:state': [{ id: 'profile_views', enabled: false, dailyLimit: 40 }],
    });
    const pymkHarvestPage = vi.fn(dry);
    const res = await runViewWithFallback(
      fallback(store, { searchHarvestPage: dry, pymkHarvestPage }),
    );
    expect(pymkHarvestPage).not.toHaveBeenCalled();
    expect(res.reason).toBe('disabled');
  });

  // STOP means stop: a run cancelled during the search pass must NOT then navigate to
  // /mynetwork/ and act — it reports cancelled, PYMK never runs.
  it('does NOT run PYMK when the search pass was cancelled (STOP means stop)', async () => {
    const store = fakeStore(enabled);
    const pymkHarvestPage = vi.fn(dry);
    const res = await runViewWithFallback(
      fallback(store, { cancelled: async () => true, pymkHarvestPage }),
    );
    expect(pymkHarvestPage).not.toHaveBeenCalled();
    expect(res.reason).toBe('cancelled');
  });

  it('runs PYMK-only when there are no keywords (searchUrl null)', async () => {
    const store = fakeStore(enabled);
    const pymkHarvestPage = vi.fn(async () => ok([cand('9')]));
    const res = await runViewWithFallback(fallback(store, { searchUrl: null, pymkHarvestPage }));
    expect(pymkHarvestPage).toHaveBeenCalled();
    expect(res.executed).toBe(1);
  });
});
