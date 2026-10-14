// SW-side Smart Connect orchestration. Deps injected → unit-testable with fakes.
import type { Clock, KeyValueStore, Rng } from '@lib/ports';
import type { HarvestResult, PersonCandidate } from '@lib/types';
import { asArray } from '@lib/engagement/settings';
import { enabledModules } from '@lib/autopilot/startGate';
import { peopleSearchUrl } from '@lib/connect/peopleSearchUrl';
import { allowsPymkFill, loadConnectSettings } from '@lib/connect/settings';
import { filterExcluded, geoUrnsForConnect, resolveExcludeKeywords } from '@lib/connect/exclusion';
import { selectCandidates } from '@lib/connect/selectCandidates';
import {
  isoWeekKey,
  rolloverConnectWeek,
  remainingConnects,
  connectsPerWeek,
  connectRunCap,
  CONNECT_WEEK_BUDGET_KEY,
  type ConnectWeek,
  rolloverConnectDay,
  dailyConnectCap,
  remainingDailyConnects,
  CONNECT_DAY_BUDGET_KEY,
  type ConnectDay,
} from '@lib/connect/ConnectWeekBudget';
import { CONNECT_SENT_KEY } from '@lib/connect/ConnectHistory';

export const PYMK_URL = 'https://www.linkedin.com/mynetwork/grow/';

export interface ConnectDeps {
  store: KeyValueStore;
  clock: Clock;
  rng: Rng;
  /** Navigate to the people-search; resolves true only if the page actually loaded. */
  navigate: (url: string) => Promise<boolean>;
  /** Harvest the CURRENTLY-loaded search page only (NOT paginated) — a candidate's Connect
   * anchor is only in the DOM while its page is loaded, so we must connect per-page. */
  harvest: () => Promise<HarvestResult>;
  /** Advance the people-search to the next page; false if there is no next page. */
  nextPage: () => Promise<boolean>;
  connect: (
    c: PersonCandidate,
  ) => Promise<{ ok: boolean; reason?: string; safetySpent?: boolean } | undefined>;
  pace: () => Promise<void>;
  /** True if the run was stopped (STOP_AUTOPILOT) — the per-candidate loop MUST abort. */
  cancelled: () => Promise<boolean>;
}

export interface ConnectStepResult {
  executed: number;
  skipped: number;
  /**
   * Machine code for WHY the step did what it did — surfaced in the run report so a
   * zero-connect run is never silent. One of: disabled | budget | no_keywords |
   * nav_failed | empty_search | not_ready | pool_pending | none_fresh | cancelled |
   * unreachable | <executeConnect failure> | done.
   */
  reason: string;
  /**
   * True ONLY when the pass connected its full run cap. Absent/false on every partial or
   * zero pass — the signal `runConnectWithFallback` uses to decide whether PYMK top-up is
   * needed (a search that fell short of the cap still has budget to top up).
   */
  capReached?: boolean;
  safetySpent?: number;
  /** Effective safety allowance for this pass, used to cap a fallback pass. */
  safetyCap?: number;
}

/** Max search pages to walk in one connect pass (safety bound; cap usually stops us first). */
const CONNECT_MAX_PAGES = 5;

/**
 * One Smart Connect pass: gate on module + weekly/daily budget + keywords, navigate to the
 * people-search, then PER PAGE harvest → connect its fresh candidates → advance. Connecting
 * per-page is load-bearing: a candidate's Connect `<a>` exists in the DOM only while ITS page
 * is loaded, so harvesting across pagination then connecting later misses every anchor that
 * isn't on the current page (the connect_anchor_not_found bug). Persist week + day + sent-set.
 */
export async function runConnectStep(
  deps: ConnectDeps,
  opts: { source?: 'search' | 'pymk'; safetyLimit?: number } = {},
): Promise<ConnectStepResult> {
  const modulesState = await deps.store.get('modules:state');
  if (await deps.cancelled()) return cancelledResult();
  if (!enabledModules(modulesState).some((m) => m.id === 'smart_connect')) {
    return { executed: 0, skipped: 0, reason: 'disabled' };
  }
  const perWeek = connectsPerWeek(modulesState);
  const budget = rolloverConnectWeek(
    (await deps.store.get<ConnectWeek>(CONNECT_WEEK_BUDGET_KEY)) ?? null,
    isoWeekKey(deps.clock.now()),
  );
  if (await deps.cancelled()) return cancelledResult();
  const weeklyRemaining = remainingConnects(budget, perWeek);
  if (weeklyRemaining <= 0) return { executed: 0, skipped: 0, reason: 'budget' };
  const dayBudget = rolloverConnectDay(
    (await deps.store.get<ConnectDay>(CONNECT_DAY_BUDGET_KEY)) ?? null,
    deps.clock.now().toISOString().slice(0, 10),
  );
  if (await deps.cancelled()) return cancelledResult();
  const dailyRemaining = remainingDailyConnects(dayBudget, dailyConnectCap(perWeek));
  const naturalCap = connectRunCap(weeklyRemaining, dailyRemaining, perWeek, deps.rng);
  const cap = Math.min(naturalCap, Math.max(0, opts.safetyLimit ?? naturalCap));
  if (cap <= 0) return { executed: 0, skipped: 0, reason: 'budget' };

  const source = opts.source ?? 'search';
  let url: string;
  if (source === 'pymk') {
    url = PYMK_URL; // PYMK is keyword-free — LinkedIn curates the list
  } else {
    const settings = await loadConnectSettings(deps.store);
    if (await deps.cancelled()) return cancelledResult();
    if (!settings.searchKeywords.trim()) return { executed: 0, skipped: 0, reason: 'no_keywords' };
    url = peopleSearchUrl(
      settings.searchKeywords,
      geoUrnsForConnect(settings.targetRegions, settings.excludeIndia),
    );
  }
  const navOk = await deps.navigate(url);
  if (!navOk) return { executed: 0, skipped: 0, reason: 'nav_failed' };
  if (await deps.cancelled()) return cancelledResult();
  const sent = new Set(asArray<string>(await deps.store.get<string[]>(CONNECT_SENT_KEY)));
  if (await deps.cancelled()) return cancelledResult();

  const sentRecords: PersonCandidate[] = [];
  let safetySpent = 0;
  let lastFailReason: string | null = null;
  let sawUndefined = false;
  let cancelled = false;
  let sawAnyCandidate = false;
  let sawNoneConnectable = false;
  for (let page = 0; page < CONNECT_MAX_PAGES; page++) {
    if (await deps.cancelled()) {
      cancelled = true;
      break;
    }
    const { candidates, outcome } = await deps.harvest();
    if (await deps.cancelled()) {
      cancelled = true;
      break;
    }
    // A dead page ends the walk. On page 0 it's the whole run's reason (empty / never
    // rendered); deeper, just stop paging and keep whatever earlier pages already connected.
    if (outcome === 'empty' || outcome === 'not_ready') {
      if (page === 0)
        return {
          executed: 0,
          skipped: 0,
          reason: outcome === 'empty' ? 'empty_search' : 'not_ready',
        };
      break;
    }
    // Page rendered but everyone is already Pending/connected — page DEEPER for the sparse
    // still-connectable recruiters instead of bailing (the saturated-pool bug: page 1 is all
    // Pending, so returning here left "connects 0" every run). Views already page like this.
    if (outcome === 'none_connectable') sawNoneConnectable = true;
    const settings = await loadConnectSettings(deps.store);
    const visible = filterExcluded(candidates, resolveExcludeKeywords(settings));
    sawAnyCandidate = sawAnyCandidate || candidates.length > 0;
    const fresh = selectCandidates(visible, sent, cap - safetySpent);
    for (const c of fresh) {
      if (await deps.cancelled()) {
        cancelled = true;
        break;
      }
      const res = await deps.connect(c);
      const stoppedAfterConnect = await deps.cancelled();
      const spent = res?.ok === true || res?.safetySpent === true;
      if (res?.ok) {
        sentRecords.push(c);
      }
      if (spent) {
        safetySpent += 1;
        sent.add(c.memberId);
      }
      if (res === undefined) {
        sawUndefined = true;
      } else if (res?.reason) {
        lastFailReason = res.reason;
      }
      if (stoppedAfterConnect) {
        cancelled = true;
        break;
      }
      // Pace ONLY after a real send — the human-like 8-30s wait is anti-ban for actual actions.
      // Pacing after a failed/no-op connect (anchor gone, no flip) just stalls the run (the
      // "infinite pauses" symptom) without any action to space out.
      if (spent) {
        await deps.pace();
        if (await deps.cancelled()) {
          cancelled = true;
          break;
        }
      }
    }
    if (cancelled) break;
    if (safetySpent >= cap) break;
    if (!(await deps.nextPage())) break; // no more pages
    if (await deps.cancelled()) {
      cancelled = true;
      break;
    }
  }
  // Reason precedence: cancelled → done (≥1 sent) → pool_pending (walked pages, everyone on
  // them already invited/Pending) → empty (never saw a candidate) → a named executeConnect
  // failure → unreachable (no response from content) → none_fresh (all already in the sent-set).
  const reason = cancelled
    ? 'cancelled'
    : sentRecords.length > 0
      ? 'done'
      : sawNoneConnectable
        ? 'pool_pending'
        : !sawAnyCandidate
          ? 'empty_search'
          : (lastFailReason ?? (sawUndefined ? 'unreachable' : 'none_fresh'));
  return {
    executed: sentRecords.length,
    skipped: 0,
    reason,
    capReached: safetySpent >= cap,
    safetySpent,
    safetyCap: cap,
  };
}

function cancelledResult(): ConnectStepResult {
  return { executed: 0, skipped: 0, reason: 'cancelled', capReached: false };
}

export interface FallbackDeps extends ConnectDeps {
  /** Scroll-harvest PYMK connectable people (the fallback source). */
  pymkHarvest: () => Promise<HarvestResult>;
}

/**
 * Smart Connect with PYMK fallback: run the people-search pass; if it did NOT fill its run cap
 * (any reason except module-off / no-budget / cancelled), TOP UP the remaining connect budget
 * from PYMK (/mynetwork/). This covers the search-limit bug: LinkedIn caps search so the pass
 * connects only 1-2, well under the ~14 daily cap — the run must top up in the SAME pass, not
 * force a second manual run. Budget/sent-set/history are shared — the PYMK pass re-reads the
 * (now-decremented) budget, so search+PYMK together stay within the daily cap
 * (search.executed + pymk ≤ search.executed + dailyRemaining = dailyCap).
 */
// Search-pass reasons that must NOT fall back to PYMK:
// - disabled/budget: nothing to top up (module off / cap spent).
// - cancelled: STOP means stop — never navigate to /mynetwork/ and act after the user stopped.
// `no_keywords` DOES fall through to PYMK (deliberate — Vlad, 2026-07-14): an enabled Smart
// Connect with no keywords still tops up from LinkedIn's own suggestions (PYMK is keyword-free).
const NO_PYMK_FALLBACK = new Set(['disabled', 'budget', 'cancelled']);

export async function runConnectWithFallback(deps: FallbackDeps): Promise<ConnectStepResult> {
  const search = await runConnectStep(deps);
  // Hit the run cap on search alone, or a hard-stop reason → done, no PYMK needed.
  if (search.capReached || NO_PYMK_FALLBACK.has(search.reason)) return search;
  const settings = await loadConnectSettings(deps.store);
  if (!allowsPymkFill(settings.pymkMode)) return search;
  if (await deps.cancelled()) return { ...search, reason: 'cancelled', capReached: false };

  const pymk = await runConnectStep(
    { ...deps, harvest: deps.pymkHarvest, nextPage: () => Promise.resolve(false) },
    {
      source: 'pymk',
      ...(search.safetyCap !== undefined
        ? {
            safetyLimit: Math.max(0, search.safetyCap - (search.safetySpent ?? search.executed)),
          }
        : {}),
    },
  );
  // Combine: search may have connected 1-2 before falling short; PYMK tops up the rest.
  const executed = search.executed + pymk.executed;
  const safetySpent = (search.safetySpent ?? search.executed) + (pymk.safetySpent ?? pymk.executed);
  const safetyCap = search.safetyCap ?? pymk.safetyCap;
  const combined = {
    executed,
    skipped: 0,
    safetySpent,
    ...(safetyCap !== undefined ? { safetyCap, capReached: safetySpent >= safetyCap } : {}),
  };
  if (executed > 0) return { ...combined, reason: 'done' };
  // Nobody from search OR PYMK. A genuine PYMK FAILURE (nav_failed / unreachable / a named
  // executeConnect failure) must surface honestly — NOT be masked as pymk_dry ("try later"),
  // which would hide a real break (e.g. a PYMK Connect that direct-sends with no modal →
  // send_button_not_found). Only a genuinely-empty PYMK (empty_search / none_fresh) is pymk_dry.
  const pymkGenuinelyDry = pymk.reason === 'empty_search' || pymk.reason === 'none_fresh';
  return { ...combined, reason: pymkGenuinelyDry ? 'pymk_dry' : pymk.reason };
}
