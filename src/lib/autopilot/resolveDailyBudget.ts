/** Persisted per-day autopilot budget (the ceiling is *daily*). */
export interface AutopilotDay {
  /** UTC day key, YYYY-MM-DD. */
  day: string;
  ceiling: number;
  used: number;
}

/**
 * Resolves the autopilot budget for `today`. Same-day re-runs carry over the
 * ceiling AND the used count, so pressing Start twice in a day does NOT grant a
 * fresh allowance — the cap is genuinely daily. A new day resets to a freshly
 * drawn ceiling. Pure.
 */
export function resolveDailyBudget(
  prev: AutopilotDay | null,
  today: string,
  freshCeiling: number,
): AutopilotDay {
  if (prev && prev.day === today) return prev;
  return { day: today, ceiling: freshCeiling, used: 0 };
}
