import type { Rng } from '../ports';

/**
 * Produces a randomised "human" pause between actions (8–45s random, never fixed). Pure given an injected Rng, so tests are
 * deterministic. The service worker awaits this between gated actions.
 */
export class HumanDelay {
  constructor(private readonly rng: Rng) {}

  /** A delay in ms uniformly spread across [minMs, maxMs]. */
  nextMs(minMs: number, maxMs: number): number {
    return Math.round(minMs + this.rng.next() * (maxMs - minMs));
  }
}
