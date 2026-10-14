import type { ProfileViewsSnapshot } from '../types';
import { daysBetween } from '../history/dailyHistory';

export interface ViewsProgress {
  /** True once there are ≥2 snapshots to compare (otherwise no honest delta). */
  hasBaseline: boolean;
  /** Oldest snapshot in range ("как было"). */
  from: ProfileViewsSnapshot | null;
  /** Latest snapshot ("как стало"). */
  to: ProfileViewsSnapshot | null;
  /** Whole days between baseline and latest. */
  spanDays: number;
  countFrom: number;
  countTo: number;
  /** countTo − countFrom. May be negative — a rolling window legitimately drops. */
  countDelta: number;
  /** Rolling window of the latest snapshot, for an honest "за N дней" label. */
  windowDays: number;
  /** Count per snapshot, oldest→newest (aligned to history order) — for the sparkline. */
  values: number[];
}

const EMPTY: ViewsProgress = {
  hasBaseline: false,
  from: null,
  to: null,
  spanDays: 0,
  countFrom: 0,
  countTo: 0,
  countDelta: 0,
  windowDays: 0,
  values: [],
};

/**
 * Baseline→latest progress over the whole retained profile-views history. Pure,
 * scalar analogue of SSI's `computeProgress` (one count vs four pillars).
 * `from` is the oldest snapshot, `to` the newest; the delta is latest − baseline.
 * With <2 snapshots there is no honest baseline (`hasBaseline:false`).
 */
export function computeViewsProgress(history: readonly ProfileViewsSnapshot[]): ViewsProgress {
  if (history.length === 0) return { ...EMPTY };
  const from = history[0];
  const to = history[history.length - 1];
  return {
    hasBaseline: history.length >= 2,
    from,
    to,
    spanDays: daysBetween(from.capturedAt, to.capturedAt),
    countFrom: from.count,
    countTo: to.count,
    countDelta: to.count - from.count,
    windowDays: to.windowDays,
    values: history.map((s) => s.count),
  };
}
