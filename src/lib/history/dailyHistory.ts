/**
 * Generic day-bucketed history — the shared engine behind SSI history and
 * profile-views history. Payload-agnostic: works over anything carrying a
 * `capturedAt` ISO string, so adding a new daily metric never copies this logic.
 */

export const DAY_MS = 86_400_000;

/** Whole days between two ISO timestamps (0 if either is unparseable). Pure. */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.max(0, Math.round(Math.abs(tb - ta) / DAY_MS));
}

/**
 * UTC calendar-day bucket (YYYY-MM-DD) for a snapshot's capturedAt.
 * Invalid dates key by their raw string so corrupt/non-date values stay unique
 * rather than collapsing into one bucket.
 */
export function dayKey(capturedAt: string): string {
  const t = Date.parse(capturedAt);
  return Number.isNaN(t) ? capturedAt : new Date(t).toISOString().slice(0, 10);
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * Fold a fresh snapshot into day-bucketed history: exactly one entry per calendar
 * day (UTC), where the latest capture wins for that day. Result is sorted
 * oldest→newest and capped to the last `capDays` days.
 *
 * Pure and generic over `T extends { capturedAt: string }`. Tolerates a corrupt /
 * non-array stored value (chrome.storage gotcha), so a garbled history can never
 * crash a save.
 */
export function upsertDailySnapshot<T extends { capturedAt: string }>(
  existing: unknown,
  snapshot: T,
  capDays = 90,
): T[] {
  const byDay = new Map<string, T>();
  for (const s of asArray<T>(existing)) byDay.set(dayKey(s.capturedAt), s);
  byDay.set(dayKey(snapshot.capturedAt), snapshot); // newest capture wins the day
  const sorted = [...byDay.values()].sort(
    (a, b) => (Date.parse(a.capturedAt) || 0) - (Date.parse(b.capturedAt) || 0),
  );
  return capDays > 0 ? sorted.slice(-capDays) : sorted;
}
