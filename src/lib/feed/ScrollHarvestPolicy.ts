export interface ScrollState {
  collected: number;
  target: number;
  staleRounds: number;
  round: number;
}

/** Decides when to stop the scroll-harvest loop. Pure — no DOM, no timers. */
export class ScrollHarvestPolicy {
  private readonly maxStaleRounds: number;
  private readonly maxRounds: number;

  constructor(cfg: { maxStaleRounds?: number; maxRounds?: number } = {}) {
    this.maxStaleRounds = cfg.maxStaleRounds ?? 2;
    this.maxRounds = cfg.maxRounds ?? 15;
  }

  shouldStop(s: ScrollState): boolean {
    return (
      s.collected >= s.target || s.staleRounds >= this.maxStaleRounds || s.round >= this.maxRounds
    );
  }
}
