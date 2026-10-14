/**
 * Decides whether a background SSI refresh is due. Pure policy — no clock, no
 * storage, no chrome. SRP: timing decision only, so it's trivially testable and
 * reusable by any scheduler (alarm, panel-open, startup).
 */
export class RefreshPolicy {
  constructor(private readonly intervalMs: number) {}

  /**
   * @param lastRefreshAt ISO timestamp of the last successful refresh, or null.
   * @param now           Current time (injected by the caller's Clock).
   */
  isDue(lastRefreshAt: string | null, now: Date): boolean {
    if (!lastRefreshAt) return true;
    const last = Date.parse(lastRefreshAt);
    if (Number.isNaN(last)) return true;
    return now.getTime() - last >= this.intervalMs;
  }
}
