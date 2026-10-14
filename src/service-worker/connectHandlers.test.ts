import { describe, it, expect, vi } from 'vitest';
import { runConnectStep, runConnectWithFallback } from './connectHandlers';
import { CONNECT_WEEK_BUDGET_KEY, CONNECT_DAY_BUDGET_KEY } from '@lib/connect/ConnectWeekBudget';
import { CONNECT_HISTORY_KEY, CONNECT_SENT_KEY } from '@lib/connect/ConnectHistory';
import type { PersonCandidate } from '@lib/types';

const cand = (id: string): PersonCandidate => ({
  memberId: id,
  name: id,
  headline: 'Recruiter',
  profileUrl: `/in/${id}`,
});

function deps(over: Partial<Record<string, unknown>> = {}) {
  const m = new Map<string, unknown>();
  m.set('modules:state', [
    {
      id: 'smart_connect',
      enabled: true,
      available: true,
      automationLevel: 'manual',
      dailyLimit: 100,
    },
  ]);
  m.set('connect:settings', { searchKeywords: 'frontend recruiter' });
  return {
    store: {
      get: async <T>(k: string) => (m.get(k) as T) ?? null,
      set: async (k: string, v: unknown) => void m.set(k, v),
    },
    clock: { now: () => new Date('2026-06-26T00:00:00Z') },
    rng: { next: () => 1 }, // no downward jitter → dailyShare = 14
    navigate: vi.fn(async () => true),
    harvest: vi.fn(async () => ({ candidates: [cand('1'), cand('2')], outcome: 'ok' as const })),
    nextPage: vi.fn(async () => false),
    connect: vi.fn(async () => ({ ok: true })),
    pace: vi.fn(async () => {}),
    cancelled: vi.fn(async () => false),
    _m: m,
    ...over,
  };
}

describe('runConnectStep', () => {
  it('navigates, harvests and delegates accounting to effect receipts', async () => {
    const d = deps();
    const res = await runConnectStep(d);
    // default region US → geoUrn appended (settings has no targetRegions → defaults to ['US'])
    expect(d.navigate).toHaveBeenCalledWith(
      'https://www.linkedin.com/search/results/people/?keywords=frontend%20recruiter&geoUrn=%5B%22103644278%22%5D&origin=FACETED_SEARCH',
    );
    expect(d.connect).toHaveBeenCalledTimes(2);
    expect(res.executed).toBe(2);
    expect(res.reason).toBe('done');
    expect(d._m.get(CONNECT_WEEK_BUDGET_KEY)).toBeUndefined();
    expect(d._m.get(CONNECT_DAY_BUDGET_KEY)).toBeUndefined();
    expect(d._m.get(CONNECT_SENT_KEY)).toBeUndefined();
    expect(d._m.get(CONNECT_HISTORY_KEY)).toBeUndefined();
  });

  it('returns early when the daily cap is reached (even if the week has room)', async () => {
    const d = deps();
    // dailyConnectCap(100) = 14 → seed today at the cap so the day is exhausted.
    d._m.set(CONNECT_DAY_BUDGET_KEY, { day: '2026-06-26', used: 14 });
    const res = await runConnectStep(d);
    expect(res.executed).toBe(0);
    expect(d.harvest).not.toHaveBeenCalled();
  });

  it('skips already-sent candidates across runs', async () => {
    const d = deps();
    d._m.set(CONNECT_SENT_KEY, ['1']);
    const res = await runConnectStep(d);
    expect(d.connect).toHaveBeenCalledTimes(1);
    expect(res.executed).toBe(1);
  });

  it('returns early when the module is disabled', async () => {
    const d = deps();
    d._m.set('modules:state', [
      {
        id: 'smart_connect',
        enabled: false,
        available: true,
        automationLevel: 'manual',
        dailyLimit: 100,
      },
    ]);
    const res = await runConnectStep(d);
    expect(res).toEqual({ executed: 0, skipped: 0, reason: 'disabled' });
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it('returns early when the weekly budget is exhausted', async () => {
    const d = deps();
    d._m.set(CONNECT_WEEK_BUDGET_KEY, { week: '2026-W26', used: 100 });
    const res = await runConnectStep(d);
    expect(res.reason).toBe('budget');
    expect(d.harvest).not.toHaveBeenCalled();
  });

  // A run reads persisted storage ONLY: no keywords saved → safe no-op + honest report signal.
  // (The Modules card persists its prefill on open, so a seen-in-the-card value is always saved;
  // this path is the "card never opened / keywords wiped" case — must not connect on a guess.)
  it('returns early when there are no search keywords', async () => {
    const d = deps();
    d._m.set('connect:settings', { searchKeywords: '' });
    const res = await runConnectStep(d);
    expect(res.reason).toBe('no_keywords');
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it('reports nav_failed when the search page never confirmed loaded', async () => {
    const d = deps({ navigate: vi.fn(async () => false) });
    const res = await runConnectStep(d);
    expect(res).toMatchObject({ executed: 0, reason: 'nav_failed' });
    expect(d.harvest).not.toHaveBeenCalled();
    expect(d.connect).not.toHaveBeenCalled();
  });

  it('starts no harvest after STOP lands during navigation', async () => {
    let stopped = false;
    const d = deps({
      navigate: vi.fn(async () => {
        stopped = true;
        return true;
      }),
      cancelled: vi.fn(async () => stopped),
    });

    expect(await runConnectStep(d)).toMatchObject({ executed: 0, skipped: 0, reason: 'cancelled' });
    expect(d.harvest).not.toHaveBeenCalled();
  });

  it('starts no connect after STOP lands during harvest', async () => {
    let stopped = false;
    const d = deps({
      harvest: vi.fn(async () => {
        stopped = true;
        return { candidates: [cand('1')], outcome: 'ok' as const };
      }),
      cancelled: vi.fn(async () => stopped),
    });

    expect((await runConnectStep(d)).reason).toBe('cancelled');
    expect(d.connect).not.toHaveBeenCalled();
  });

  it('reports empty_search when the people-search rendered zero results', async () => {
    const d = deps({ harvest: vi.fn(async () => ({ candidates: [], outcome: 'empty' as const })) });
    const res = await runConnectStep(d);
    expect(res).toMatchObject({ executed: 0, reason: 'empty_search' });
    expect(d.connect).not.toHaveBeenCalled();
  });

  it('reports not_ready when the search page never rendered its cards', async () => {
    const d = deps({
      harvest: vi.fn(async () => ({ candidates: [], outcome: 'not_ready' as const })),
    });
    const res = await runConnectStep(d);
    expect(res).toMatchObject({ executed: 0, reason: 'not_ready' });
  });

  // The saturated-pool bug: over weeks Vlad invited everyone on page 1, so its cards are all
  // "Pending" → harvest returns none_connectable. The step must NOT bail (that's what left
  // "connects 0 every run") — it pages deeper to the sparse still-connectable recruiters.
  it('pages PAST an all-Pending page (none_connectable) to reach connectable people deeper', async () => {
    let page = 0;
    const outcomes = [
      { candidates: [] as PersonCandidate[], outcome: 'none_connectable' as const }, // page 1: all Pending
      { candidates: [cand('3'), cand('4')], outcome: 'ok' as const }, // page 2: connectable
    ];
    const d = deps({
      harvest: vi.fn(async () => outcomes[page] ?? { candidates: [], outcome: 'empty' as const }),
      nextPage: vi.fn(async () => {
        page++;
        return page < outcomes.length;
      }),
    });
    const res = await runConnectStep(d);
    expect(d.connect).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ executed: 2, reason: 'done' });
  });

  // Whole search saturated: every page all-Pending. Honest reason (not the lying not_ready)
  // so the report tells Vlad to broaden/rotate keywords instead of "page didn't load".
  it('reports pool_pending when EVERY walked page is all-Pending (nobody connectable anywhere)', async () => {
    const d = deps({
      harvest: vi.fn(async () => ({
        candidates: [] as PersonCandidate[],
        outcome: 'none_connectable' as const,
      })),
      nextPage: vi.fn(async () => true), // always another page; bounded by CONNECT_MAX_PAGES
    });
    const res = await runConnectStep(d);
    expect(res).toMatchObject({ executed: 0, reason: 'pool_pending' });
    expect(d.connect).not.toHaveBeenCalled();
    expect(d.harvest.mock.calls.length).toBeGreaterThan(1); // walked past page 1, up to the cap
  });

  it('reports none_fresh when everyone harvested was already invited', async () => {
    const d = deps();
    d._m.set(CONNECT_SENT_KEY, ['1', '2']);
    const res = await runConnectStep(d);
    expect(res).toMatchObject({ executed: 0, reason: 'none_fresh' });
    expect(d.connect).not.toHaveBeenCalled();
  });

  it('surfaces the executeConnect failure reason when every invite attempt fails', async () => {
    const d = deps({
      connect: vi.fn(async () => ({ ok: false, reason: 'send_button_not_found' })),
    });
    const res = await runConnectStep(d);
    expect(d.connect).toHaveBeenCalledTimes(2); // it DID try
    expect(res).toMatchObject({ executed: 0, reason: 'send_button_not_found' });
    expect(d._m.get(CONNECT_SENT_KEY)).toBeUndefined(); // nothing persisted
  });

  // The 8-30s human pace is anti-ban for REAL sends. Pacing after a failed/no-op connect just
  // stalls the run (the live "infinite pauses" bug) with nothing to space out.
  it('does NOT pace after a failed connect (only real sends get the anti-ban wait)', async () => {
    const d = deps({
      connect: vi.fn(async () => ({ ok: false, reason: 'send_button_not_found' })),
    });
    await runConnectStep(d);
    expect(d.pace).not.toHaveBeenCalled();
  });

  it('paces after each successful connect', async () => {
    const d = deps(); // 2 connectable, both ok
    await runConnectStep(d);
    expect(d.pace).toHaveBeenCalledTimes(2);
  });

  it('reports unreachable when the connect action gets no response', async () => {
    const d = deps({ connect: vi.fn(async () => undefined) });
    const res = await runConnectStep(d);
    expect(res).toMatchObject({ executed: 0, reason: 'unreachable' });
  });

  it('starts no next candidate after an unreachable committed effect stops the run', async () => {
    let stopped = false;
    const connect = vi.fn(async () => {
      stopped = true;
      return undefined;
    });
    const d = deps({ connect, cancelled: vi.fn(async () => stopped) });

    const res = await runConnectStep(d);

    expect(connect).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ executed: 0, reason: 'cancelled' });
  });

  it('spends the local safety cap on uncertain sends without reporting them executed', async () => {
    const connect = vi.fn(async () => ({
      ok: false,
      safetySpent: true,
      reason: 'connect_confirmation_timeout',
    }));
    const d = deps({ connect });
    d._m.set(CONNECT_DAY_BUDGET_KEY, { day: '2026-06-26', used: 13 });

    const res = await runConnectStep(d);

    expect(connect).toHaveBeenCalledOnce();
    expect(res).toMatchObject({
      executed: 0,
      reason: 'connect_confirmation_timeout',
      capReached: true,
    });
  });

  it('reports done when at least one invite succeeds (mixed results)', async () => {
    let n = 0;
    const d = deps({
      connect: vi.fn(async () =>
        ++n === 1 ? { ok: true } : { ok: false, reason: 'modal_did_not_close' },
      ),
    });
    const res = await runConnectStep(d);
    expect(res).toMatchObject({ executed: 1, reason: 'done' });
  });

  it('paginates: harvests+connects page 1, then page 2 (anchors are only on the CURRENT page)', async () => {
    // The whole point of per-page: a candidate's Connect anchor exists only while its page
    // is in the DOM. Harvest one page, connect its fresh candidates, THEN advance.
    let page = 0;
    const pages = [[cand('1'), cand('2')], [cand('3')]];
    const d = deps({
      harvest: vi.fn(async () => ({ candidates: pages[page] ?? [], outcome: 'ok' as const })),
      nextPage: vi.fn(async () => {
        page++;
        return page < pages.length;
      }),
    });
    const res = await runConnectStep(d);
    expect(d.harvest).toHaveBeenCalledTimes(2); // page 1 then page 2
    expect(d.nextPage).toHaveBeenCalledTimes(2); // advanced after page 1 (true) + page 2 (false → stop)
    expect(d.connect).toHaveBeenCalledTimes(3); // 1,2 on page 1; 3 on page 2
    expect(res).toMatchObject({ executed: 3, reason: 'done' });
  });

  it('STOPS mid-loop when the run is cancelled (STOP must interrupt a long connect pass)', async () => {
    const d = deps();
    let calls = 0;
    d.connect = vi.fn(async () => {
      calls++;
      return { ok: true };
    });
    // cancel after the first successful connect
    d.cancelled = vi.fn(async () => calls >= 1);
    const res = await runConnectStep(d);
    expect(res.executed).toBe(1); // sent one, then stopped — did NOT process the 2nd candidate
    expect(d.connect).toHaveBeenCalledTimes(1);
    expect(res.reason).toBe('cancelled');
  });

  it('starts no next candidate after STOP lands during pacing', async () => {
    let stopped = false;
    const d = deps({
      pace: vi.fn(async () => {
        stopped = true;
      }),
      cancelled: vi.fn(async () => stopped),
    });

    const res = await runConnectStep(d);

    expect(res).toMatchObject({ executed: 1, reason: 'cancelled' });
    expect(d.connect).toHaveBeenCalledTimes(1);
  });

  it('pymk source navigates to /mynetwork/ and skips the keyword gate', async () => {
    const d = deps();
    d._m.set('connect:settings', { searchKeywords: '' }); // нет ключей — не важно для PYMK
    const res = await runConnectStep(d, { source: 'pymk' });
    expect(d.navigate).toHaveBeenCalledWith('https://www.linkedin.com/mynetwork/grow/');
    expect(res.reason).not.toBe('no_keywords');
    expect(d.connect).toHaveBeenCalledTimes(2); // harvest дефолтно даёт 2
  });

  it('search source still gates on keywords (unchanged)', async () => {
    const d = deps();
    d._m.set('connect:settings', { searchKeywords: '' });
    const res = await runConnectStep(d); // default source 'search'
    expect(res.reason).toBe('no_keywords');
    expect(d.navigate).not.toHaveBeenCalled();
  });
});

describe('runConnectWithFallback', () => {
  const noHarvest = async () => ({
    candidates: [] as PersonCandidate[],
    outcome: 'empty' as const,
  });

  it('runs PYMK fallback when search yields 0 connects', async () => {
    const d = deps({ harvest: vi.fn(noHarvest) }); // search пуст
    const pymkHarvest = vi.fn(async () => ({
      candidates: [cand('7'), cand('8')],
      outcome: 'ok' as const,
    }));
    const res = await runConnectWithFallback({
      ...d,
      pymkHarvest,
      nextPage: vi.fn(async () => false),
    });
    expect(pymkHarvest).toHaveBeenCalled();
    expect(d.navigate).toHaveBeenCalledWith('https://www.linkedin.com/mynetwork/grow/');
    expect(res).toMatchObject({ executed: 2, reason: 'done' });
  });

  // The live bug (Vlad 2026-07-20): LinkedIn's search limit renders only 1-2 connectable people,
  // so the search pass connected 2 and STOPPED — leaving the daily cap (~14) far short and forcing
  // a SECOND manual run to top up from PYMK. Now the SAME run tops up the remaining budget from
  // PYMK whenever search fell short of its run cap (not only when search connected zero).
  it('tops up from PYMK when search connected FEWER than the run cap (search limit)', async () => {
    const d = deps(); // search harvest = 2 connectable; rng=1 → run cap 14
    const pymkHarvest = vi.fn(async () => ({
      candidates: [cand('7'), cand('8'), cand('9')],
      outcome: 'ok' as const,
    }));
    const res = await runConnectWithFallback({
      ...d,
      pymkHarvest,
      nextPage: vi.fn(async () => false),
    });
    expect(pymkHarvest).toHaveBeenCalled();
    expect(d.navigate).toHaveBeenCalledWith('https://www.linkedin.com/mynetwork/grow/');
    expect(res.executed).toBe(5); // 2 from search + 3 topped up from PYMK
    expect(res.reason).toBe('done');
  });

  it('shares one safety cap across uncertain search effects and the PYMK fallback', async () => {
    const connect = vi.fn(async () => ({
      ok: false,
      safetySpent: true,
      reason: 'connect_confirmation_timeout',
    }));
    const d = deps({ connect });
    d._m.set(CONNECT_DAY_BUDGET_KEY, { day: '2026-06-26', used: 11 }); // 3 left
    const pymkHarvest = vi.fn(async () => ({
      candidates: ['7', '8', '9', '10', '11'].map(cand),
      outcome: 'ok' as const,
    }));

    const res = await runConnectWithFallback({ ...d, pymkHarvest });

    expect(connect).toHaveBeenCalledTimes(3);
    expect(res).toMatchObject({ executed: 0, safetySpent: 3, capReached: true });
  });

  // The ONLY time a nonzero search skips PYMK: it already reached its run cap for the day. No
  // remaining budget to top up → don't navigate to /mynetwork/ pointlessly.
  it('does NOT run PYMK when search already reached its run cap', async () => {
    const d = deps(); // 2 connectable, rng=1
    d._m.set(CONNECT_DAY_BUDGET_KEY, { day: '2026-06-26', used: 12 }); // dailyRem=2 → run cap 2
    const pymkHarvest = vi.fn(noHarvest);
    const res = await runConnectWithFallback({ ...d, pymkHarvest });
    expect(pymkHarvest).not.toHaveBeenCalled();
    expect(res.executed).toBe(2);
    expect(res.reason).toBe('done');
  });

  it('does NOT run PYMK when the module is disabled or budget is 0', async () => {
    const d = deps({ harvest: vi.fn(noHarvest) });
    d._m.set('modules:state', [
      {
        id: 'smart_connect',
        enabled: false,
        available: true,
        automationLevel: 'manual',
        dailyLimit: 100,
      },
    ]);
    const pymkHarvest = vi.fn(noHarvest);
    const res = await runConnectWithFallback({ ...d, pymkHarvest });
    expect(pymkHarvest).not.toHaveBeenCalled();
    expect(res.reason).toBe('disabled');
  });

  it('reports pymk_dry when both search and PYMK yield 0', async () => {
    const d = deps({ harvest: vi.fn(noHarvest) });
    const pymkHarvest = vi.fn(noHarvest);
    const res = await runConnectWithFallback({
      ...d,
      pymkHarvest,
      nextPage: vi.fn(async () => false),
    });
    expect(res).toMatchObject({ executed: 0, reason: 'pymk_dry' });
  });

  // STOP means stop: a run cancelled during the search pass must NOT then navigate to
  // /mynetwork/ and act — it reports cancelled, PYMK never runs.
  it('does NOT run PYMK when the search pass was cancelled (STOP means stop)', async () => {
    const d = deps({ harvest: vi.fn(noHarvest), cancelled: vi.fn(async () => true) });
    const pymkHarvest = vi.fn(noHarvest);
    const res = await runConnectWithFallback({ ...d, pymkHarvest });
    expect(pymkHarvest).not.toHaveBeenCalled();
    expect(res.reason).toBe('cancelled');
  });

  // Deliberate (Vlad 2026-07-14): an enabled Smart Connect with NO keywords still tops up from
  // PYMK (which is keyword-free) rather than doing nothing — search's no_keywords falls through.
  it('DOES run PYMK when keywords are unset (PYMK is keyword-free)', async () => {
    const d = deps();
    d._m.set('connect:settings', { searchKeywords: '' });
    const pymkHarvest = vi.fn(async () => ({
      candidates: [cand('7'), cand('8')],
      outcome: 'ok' as const,
    }));
    const res = await runConnectWithFallback({
      ...d,
      pymkHarvest,
      nextPage: vi.fn(async () => false),
    });
    expect(pymkHarvest).toHaveBeenCalled();
    expect(res).toMatchObject({ executed: 2, reason: 'done' });
  });

  // A PYMK nav/DOM failure must surface honestly — not be masked as pymk_dry ("try later").
  // (This is what would otherwise hide a PYMK Connect that direct-sends with no modal.)
  it('surfaces a PYMK connect failure honestly instead of pymk_dry', async () => {
    const d = deps({ harvest: vi.fn(noHarvest) });
    const pymkHarvest = vi.fn(async () => ({ candidates: [cand('7')], outcome: 'ok' as const }));
    const res = await runConnectWithFallback({
      ...d,
      pymkHarvest,
      connect: vi.fn(async () => ({ ok: false, reason: 'send_button_not_found' })),
    });
    expect(res.reason).toBe('send_button_not_found');
  });
});
