import type { Rng } from '../ports';

/**
 * Occasionally inserts a longer "human break" between actions ("human got distracted"). The break threshold is drawn in [everyMin, everyMax]
 * from the same rng call, so a single rng value decides both whether and how long.
 * Pure.
 */
export class HumanBreakPolicy {
  private readonly everyMin: number;
  private readonly everyMax: number;
  private readonly breakMinMs: number;
  private readonly breakMaxMs: number;

  constructor(
    cfg: { everyMin?: number; everyMax?: number; breakMinMs?: number; breakMaxMs?: number } = {},
  ) {
    this.everyMin = cfg.everyMin ?? 6;
    this.everyMax = cfg.everyMax ?? 10;
    this.breakMinMs = cfg.breakMinMs ?? 60_000;
    this.breakMaxMs = cfg.breakMaxMs ?? 180_000;
  }

  /** Returns a break duration in ms, or 0 if no break is due yet. */
  nextBreakMs(actionsSinceBreak: number, rng: Rng): number {
    const r = rng.next();
    const threshold = Math.round(this.everyMin + r * (this.everyMax - this.everyMin));
    if (actionsSinceBreak < threshold) return 0;
    return Math.round(this.breakMinMs + r * (this.breakMaxMs - this.breakMinMs));
  }
}
