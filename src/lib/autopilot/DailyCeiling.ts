import type { Rng } from '../ports';

/**
 * The day's like ceiling: a base ± jitter draw (so it isn't the
 * same number every day), scaled down during the warmup ramp for new accounts.
 * Pure given an injected Rng.
 */
export class DailyCeiling {
  private readonly base: number;
  private readonly jitter: number;
  private readonly warmupDays: number;

  constructor(cfg: { base?: number; jitter?: number; warmupDays?: number } = {}) {
    this.base = cfg.base ?? 40;
    this.jitter = cfg.jitter ?? 10;
    this.warmupDays = cfg.warmupDays ?? 14;
  }

  /** @param warmupDay day index since account start (0-based); omit if past warmup. */
  forDay(rng: Rng, warmupDay?: number): number {
    const drawn = this.base - this.jitter + rng.next() * (2 * this.jitter);
    const ramp =
      warmupDay !== undefined && warmupDay < this.warmupDays ? warmupDay / this.warmupDays : 1;
    return Math.max(1, Math.round(drawn * ramp));
  }
}
