import type { SsiSnapshot, SsiPillarKey } from '../types';
import { DAY_MS, daysBetween } from '../history/dailyHistory';

export interface PillarDelta {
  key: SsiPillarKey;
  label: string;
  /** Baseline score (0..25). */
  from: number;
  /** Latest score (0..25). */
  to: number;
  /** to − from, rounded to 1dp. */
  delta: number;
}

export interface SsiProgress {
  /** True once there are ≥2 snapshots to compare (otherwise no honest delta). */
  hasBaseline: boolean;
  /** Oldest snapshot in range ("как было"). */
  from: SsiSnapshot | null;
  /** Latest snapshot ("как стало"). */
  to: SsiSnapshot | null;
  /** Whole days between baseline and latest. */
  spanDays: number;
  totalFrom: number;
  totalTo: number;
  /** totalTo − totalFrom, rounded to 1dp. */
  totalDelta: number;
  pillars: PillarDelta[];
}

export interface WindowedDelta {
  /** Total change over the window, rounded to 1dp. */
  delta: number;
  /** Actual span covered (days) — for an honest "за N дней" label. */
  days: number;
}

export interface PillarSeries {
  key: SsiPillarKey;
  label: string;
  /** Score per snapshot, oldest→newest (aligned to the history order). */
  values: number[];
}

const EMPTY: SsiProgress = {
  hasBaseline: false,
  from: null,
  to: null,
  spanDays: 0,
  totalFrom: 0,
  totalTo: 0,
  totalDelta: 0,
  pillars: [],
};

/**
 * Baseline→latest progress over the whole retained history. Pure.
 * `from` is the oldest snapshot, `to` the newest; deltas are latest − baseline.
 * With <2 snapshots there is no honest baseline (`hasBaseline:false`).
 */
export function computeProgress(history: readonly SsiSnapshot[]): SsiProgress {
  if (history.length === 0) return { ...EMPTY };
  const from = history[0];
  const to = history[history.length - 1];
  return {
    hasBaseline: history.length >= 2,
    from,
    to,
    spanDays: daysBetween(from.capturedAt, to.capturedAt),
    totalFrom: round1(from.total),
    totalTo: round1(to.total),
    totalDelta: round1(to.total - from.total),
    pillars: diffPillars(from, to),
  };
}

/**
 * Total change vs the earliest snapshot within the last `windowDays`. Falls back
 * to the full span when history is shorter than the window. `null` when there
 * are fewer than 2 snapshots (no honest number to show). Pure.
 */
export function windowedDelta(
  history: readonly SsiSnapshot[],
  windowDays: number,
): WindowedDelta | null {
  if (history.length < 2) return null;
  const to = history[history.length - 1];
  const cutoff = (Date.parse(to.capturedAt) || 0) - windowDays * DAY_MS;
  const inWindow = history.filter((s) => (Date.parse(s.capturedAt) || 0) >= cutoff);
  const from = inWindow.length >= 2 ? inWindow[0] : history[0];
  return {
    delta: round1(to.total - from.total),
    days: daysBetween(from.capturedAt, to.capturedAt),
  };
}

/**
 * Per-pillar score series across history (oldest→newest), keyed off the latest
 * snapshot's pillar set so labels stay current. A snapshot missing a pillar
 * contributes 0 for that step. Pure.
 */
export function pillarSeries(history: readonly SsiSnapshot[]): PillarSeries[] {
  if (history.length === 0) return [];
  const latest = history[history.length - 1];
  return latest.pillars.map((p) => ({
    key: p.key,
    label: p.label,
    values: history.map((s) => s.pillars.find((x) => x.key === p.key)?.score ?? 0),
  }));
}

function diffPillars(from: SsiSnapshot, to: SsiSnapshot): PillarDelta[] {
  return to.pillars.map((p) => {
    const before = from.pillars.find((x) => x.key === p.key)?.score ?? 0;
    return {
      key: p.key,
      label: p.label,
      from: round1(before),
      to: round1(p.score),
      delta: round1(p.score - before),
    };
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
