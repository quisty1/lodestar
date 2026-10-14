import { recordEffectForPeriod } from '../autopilot/EffectCounter';

/** Persisted week-keyed posts/week counter (mirrors IdeaDayBudget, ISO-week). */
export interface PostWeek {
  week: string;
  used: number;
  effectIds?: string[];
}

export const POST_WEEK_BUDGET_KEY = 'posts:budget';
export const DEFAULT_POSTS_PER_WEEK = 3;

/** ISO-8601 year-week key, e.g. "2026-W26". Pure. */
export function isoWeekKey(d: Date): string {
  // Copy to UTC midnight; shift to the Thursday of this week (ISO weeks anchor on it).
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // Sun=0 → 7
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Same-week carry-over (don't re-grant); a new week resets used to 0. Pure. */
export function rolloverPostWeek(prev: PostWeek | null, weekKey: string): PostWeek {
  if (prev && prev.week === weekKey) return prev;
  return { week: weekKey, used: 0 };
}

export function recordPostWeek(state: PostWeek, n: number): PostWeek {
  return { ...state, used: state.used + Math.max(0, n) };
}

export function recordPostWeekEffect(
  current: PostWeek | null,
  week: string,
  effectId: string,
  n = 1,
): PostWeek {
  return recordEffectForPeriod(
    current,
    current?.week,
    week,
    () => ({ week, used: 0 }),
    effectId,
    n,
  );
}

export function remainingPosts(state: PostWeek, limit: number): number {
  return Math.max(0, limit - state.used);
}
