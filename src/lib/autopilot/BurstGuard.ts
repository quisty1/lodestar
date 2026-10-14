/**
 * Rolling-window rate limiter : at most N actions per
 * window. Pure — caller passes the recent action timestamps + now. When at the
 * limit, returns how long until the oldest in-window action ages out.
 */
export class BurstGuard {
  private readonly maxActions: number;
  private readonly windowMs: number;

  constructor(cfg: { maxActions?: number; windowMs?: number } = {}) {
    this.maxActions = cfg.maxActions ?? 5;
    this.windowMs = cfg.windowMs ?? 3 * 60_000;
  }

  check(timestamps: number[], now: number): { ok: boolean; waitMs: number } {
    const inWindow = timestamps.filter((t) => now - t < this.windowMs).sort((a, b) => a - b);
    if (inWindow.length < this.maxActions) return { ok: true, waitMs: 0 };
    const oldest = inWindow[0];
    return { ok: false, waitMs: oldest + this.windowMs - now };
  }
}
