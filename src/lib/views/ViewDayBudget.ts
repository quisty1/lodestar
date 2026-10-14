import type { ModuleState } from '../types';
import type { Rng } from '../ports';
import { asArray } from '../engagement/settings';
import { recordEffectForPeriod } from '../autopilot/EffectCounter';

export const VIEW_DAY_BUDGET_KEY = 'views:daily';
export const VIEW_SEEN_KEY = 'views:seen';
export const DEFAULT_VIEWS_PER_DAY = 40;

/** Persisted day-keyed profile-views/day counter (YYYY-MM-DD) — the daily anti-ban ceiling. */
export interface ViewDay {
  day: string;
  used: number;
  effectIds?: string[];
}

export function rolloverViewDay(prev: ViewDay | null, dayKey: string): ViewDay {
  if (prev && prev.day === dayKey) return prev;
  return { day: dayKey, used: 0 };
}

export function recordViewDay(state: ViewDay, n: number): ViewDay {
  return { ...state, used: state.used + Math.max(0, n) };
}

export function recordViewDayEffect(
  current: ViewDay | null,
  day: string,
  effectId: string,
  n = 1,
): ViewDay {
  return recordEffectForPeriod(current, current?.day, day, () => ({ day, used: 0 }), effectId, n);
}

export function remainingDailyViews(state: ViewDay, dailyCap: number): number {
  return Math.max(0, dailyCap - state.used);
}

/** The daily view cap = the profile_views module's limit input (default 40). */
export function viewsPerDay(modulesState: unknown): number {
  const m = asArray<ModuleState>(modulesState).find((x) => x?.id === 'profile_views');
  return typeof m?.dailyLimit === 'number' && m.dailyLimit > 0
    ? m.dailyLimit
    : DEFAULT_VIEWS_PER_DAY;
}

/**
 * How many to view THIS run. Views are the safest action, but firing the whole day in one burst is
 * still implausible — cap at the daily limit with DOWNWARD-only jitter, bounded by the day's remaining
 * allowance. Pure (jitter via the Rng port).
 */
export function viewRunCap(dailyRemaining: number, dailyLimit: number, rng: Rng): number {
  const maxDown = Math.ceil(dailyLimit * 0.4);
  const jittered = dailyLimit - Math.floor((1 - rng.next()) * (maxDown + 1));
  return Math.max(0, Math.min(dailyRemaining, jittered));
}
