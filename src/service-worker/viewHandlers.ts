// SW-side Profile Views orchestration. Deps injected → unit-testable with fakes.
import type { KeyValueStore, Clock, Rng } from '@lib/ports';
import type { HarvestResult, ModuleState, PersonCandidate } from '@lib/types';
import { asArray } from '@lib/engagement/settings';
import { selectCandidates } from '@lib/connect/selectCandidates';
import { allowsPymkFill, loadConnectSettings } from '@lib/connect/settings';
import { filterExcluded, resolveExcludeKeywords } from '@lib/connect/exclusion';
import { harvestPeoplePaginated } from '@/content/harvestPeople';
import {
  VIEW_DAY_BUDGET_KEY,
  VIEW_SEEN_KEY,
  rolloverViewDay,
  remainingDailyViews,
  viewRunCap,
  DEFAULT_VIEWS_PER_DAY,
} from '@lib/views/ViewDayBudget';
import { PYMK_URL } from './connectHandlers';

// Page deep enough to refill the cap with FRESH faces (a static search repeats people,
// so the first pages saturate the seen-set fast), but bounded — LinkedIn's free search has
// finite depth + a monthly commercial-use limit, and pagination stops at the last page anyway.
const VIEW_HARVEST_MAX_PAGES = 20;

export interface ViewDeps {
  store: KeyValueStore;
  clock: Clock;
  rng: Rng;
  searchUrl: string;
  /** Navigate to a URL; resolves true only if the page actually loaded. */
  navigate: (url: string) => Promise<boolean>;
  /** Harvest the CURRENT people-search page (no pagination). */
  harvestPage: () => Promise<HarvestResult>;
  /** Advance to the next results page; false when there is none. */
  nextPage: () => Promise<boolean>;
  dwell: () => Promise<{ ok: boolean } | undefined>;
  /** Production effect boundary: commits immediately before profile navigation. */
  view?: (candidate: PersonCandidate) => Promise<
    | {
        ok: boolean;
        reason?: string;
        safetySpent?: boolean;
      }
    | undefined
  >;
  pace: () => Promise<void>;
  /** True if the run was stopped (STOP_AUTOPILOT) — the per-profile loop MUST abort. */
  cancelled: () => Promise<boolean>;
}

export interface ViewStepResult {
  executed: number;
  skipped: number;
  /**
   * Why the step did what it did — surfaced in the run report. One of: disabled | budget |
   * nav_failed | empty_search | not_ready | none_fresh | pool_dry | cancelled | done.
   */
  reason: string;
  safetySpent?: number;
  capReached?: boolean;
  /** Effective safety allowance for this pass, used to cap a fallback pass. */
  safetyCap?: number;
}

function dayKey(clock: Clock): string {
  return clock.now().toISOString().slice(0, 10);
}

export async function runViewStep(
  deps: ViewDeps,
  opts: { safetyLimit?: number } = {},
): Promise<ViewStepResult> {
  const modulesState = await deps.store.get('modules:state');
  if (await deps.cancelled()) return cancelledResult();
  const mod = asArray<ModuleState>(modulesState).find((m) => m?.id === 'profile_views');
  if (!mod?.enabled) return { executed: 0, skipped: 0, reason: 'disabled' };

  const dailyLimit =
    typeof mod.dailyLimit === 'number' && mod.dailyLimit > 0
      ? mod.dailyLimit
      : DEFAULT_VIEWS_PER_DAY;
  const day = rolloverViewDay(await deps.store.get(VIEW_DAY_BUDGET_KEY), dayKey(deps.clock));
  if (await deps.cancelled()) return cancelledResult();
  const remaining = remainingDailyViews(day, dailyLimit);
  const naturalCap = viewRunCap(remaining, dailyLimit, deps.rng);
  const cap = Math.min(naturalCap, Math.max(0, opts.safetyLimit ?? naturalCap));
  if (cap <= 0) return { executed: 0, skipped: 0, reason: 'budget' };

  const navOk = await deps.navigate(deps.searchUrl);
  if (!navOk) return { executed: 0, skipped: 0, reason: 'nav_failed' };
  if (await deps.cancelled()) return cancelledResult();

  // Load the seen-set BEFORE harvesting so pagination keeps walking pages until it has `cap`
  // FRESH (unseen) profiles — the fix for "viewed 3 of 40": the search pool is largely static,
  // so the first page is mostly already-seen and a blind harvest stalls there.
  const seen = new Set(asArray<string>(await deps.store.get(VIEW_SEEN_KEY)));
  if (await deps.cancelled()) return cancelledResult();
  const { candidates: harvested, outcome } = await harvestPeoplePaginated(
    async () => {
      if (await deps.cancelled()) return { candidates: [], outcome: 'not_ready' };
      return deps.harvestPage();
    },
    async () => {
      if (await deps.cancelled()) return false;
      return deps.nextPage();
    },
    { target: cap, maxPages: VIEW_HARVEST_MAX_PAGES, isFresh: (c) => !seen.has(c.memberId) },
  );
  if (await deps.cancelled()) return cancelledResult();
  if (outcome === 'empty') return { executed: 0, skipped: 0, reason: 'empty_search' };
  if (outcome === 'not_ready') return { executed: 0, skipped: 0, reason: 'not_ready' };
  const settings = await loadConnectSettings(deps.store);
  const visible = filterExcluded(harvested, resolveExcludeKeywords(settings));
  const selected = selectCandidates(visible, seen, cap);
  if (selected.length === 0)
    return { executed: 0, skipped: harvested.length, reason: 'none_fresh' };

  const records: PersonCandidate[] = [];
  let safetySpent = 0;
  let cancelled = false;
  let navigationFailed = false;
  let lastFailReason: string | undefined;
  for (const c of selected) {
    // STOP must interrupt a long views pass — without this a stop mid-pass keeps opening +
    // dwelling on every remaining profile, ignoring the user.
    if (await deps.cancelled()) {
      cancelled = true;
      break;
    }
    let r: { ok: boolean; reason?: string; safetySpent?: boolean } | undefined;
    if (deps.view) {
      r = await deps.view(c);
    } else {
      const navigated = await deps.navigate(c.profileUrl);
      if (await deps.cancelled()) {
        cancelled = true;
        break;
      }
      if (!navigated) {
        navigationFailed = true;
        break;
      }
      r = await deps.dwell();
    }
    const stoppedAfterDwell = await deps.cancelled();
    const spent = r?.ok === true || r?.safetySpent === true;
    if (r?.ok) {
      records.push(c);
    }
    if (spent) {
      safetySpent += 1;
      seen.add(c.memberId);
    }
    if (r?.reason === 'navigation_failed') navigationFailed = true;
    else if (!r?.ok && r?.reason) lastFailReason = r.reason;
    if (stoppedAfterDwell) {
      cancelled = true;
      break;
    }
    // Pace ONLY after a real view — не паузим 8-30с после неудачного dwell (иначе «бесконечные паузы»).
    if (spent) {
      await deps.pace();
      if (await deps.cancelled()) {
        cancelled = true;
        break;
      }
    }
  }

  // `pool_dry`: we found fewer fresh profiles than the cap (the search pool ran out) — an
  // honest "viewed 3, not 40" reason in the report, so an under-cap run is never silent.
  const reason = cancelled
    ? 'cancelled'
    : navigationFailed
      ? 'nav_failed'
      : records.length === 0 && lastFailReason
        ? lastFailReason
        : selected.length < cap
          ? 'pool_dry'
          : 'done';
  return {
    executed: records.length,
    skipped: selected.length - records.length,
    reason,
    safetySpent,
    capReached: safetySpent >= cap,
    safetyCap: cap,
  };
}

function cancelledResult(): ViewStepResult {
  return { executed: 0, skipped: 0, reason: 'cancelled' };
}

export interface ViewFallbackDeps extends Omit<ViewDeps, 'searchUrl' | 'harvestPage' | 'nextPage'> {
  /** People-search URL, or null when there are no keywords (skip straight to PYMK). */
  searchUrl: string | null;
  searchHarvestPage: () => Promise<HarvestResult>;
  searchNextPage: () => Promise<boolean>;
  /** Single-shot scroll-harvest of PYMK profiles (the fallback source; nextPage is false). */
  pymkHarvestPage: () => Promise<HarvestResult>;
}

/**
 * Profile Views with PYMK top-up: run the people-search views pass; if it did NOT fill the daily
 * view cap (any reason except disabled/budget/cancelled/done), top up the remaining budget from
 * PYMK (/mynetwork/). Budget + views:seen are shared (the PYMK pass re-reads the budget). Mirrors
 * runConnectWithFallback; runViewStep is already source-agnostic.
 */
export async function runViewWithFallback(deps: ViewFallbackDeps): Promise<ViewStepResult> {
  const common = {
    store: deps.store,
    clock: deps.clock,
    rng: deps.rng,
    navigate: deps.navigate,
    dwell: deps.dwell,
    pace: deps.pace,
    cancelled: deps.cancelled,
    ...(deps.view ? { view: deps.view } : {}),
  };
  let search: ViewStepResult = { executed: 0, skipped: 0, reason: 'no_keywords' };
  if (deps.searchUrl) {
    search = await runViewStep({
      ...common,
      searchUrl: deps.searchUrl,
      harvestPage: deps.searchHarvestPage,
      nextPage: deps.searchNextPage,
    });
    if (search.capReached || ['disabled', 'budget', 'cancelled'].includes(search.reason))
      return search;
  }
  const settings = await loadConnectSettings(deps.store);
  if (!allowsPymkFill(settings.pymkMode)) return search;
  const remainingSafety =
    search.safetyCap === undefined
      ? undefined
      : Math.max(0, search.safetyCap - (search.safetySpent ?? search.executed));
  const pymk = await runViewStep(
    {
      ...common,
      searchUrl: PYMK_URL,
      harvestPage: deps.pymkHarvestPage,
      nextPage: () => Promise.resolve(false),
    },
    remainingSafety === undefined ? {} : { safetyLimit: remainingSafety },
  );
  const executed = search.executed + pymk.executed;
  const safetySpent = (search.safetySpent ?? search.executed) + (pymk.safetySpent ?? pymk.executed);
  const safetyCap = search.safetyCap ?? pymk.safetyCap;
  const reason = pymk.executed > 0 ? 'done' : search.executed > 0 ? search.reason : pymk.reason;
  return {
    executed,
    skipped: search.skipped + pymk.skipped,
    reason,
    safetySpent,
    ...(safetyCap !== undefined ? { safetyCap, capReached: safetySpent >= safetyCap } : {}),
  };
}
