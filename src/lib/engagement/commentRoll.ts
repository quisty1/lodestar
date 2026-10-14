import type { Rng } from '../ports';

/**
 * Decide whether to comment on a liked post. Comments are heavier than likes (public,
 * anti-ban), so we don't comment every liked post — roughly `chance` of them, spread across
 * the feed rather than the first N in a row. The daily cap (commentsPerDay) still bounds
 * the total. Pure w.r.t. an injected Rng → unit-testable.
 */
export function rollComment(rng: Rng, chance = 1 / 3): boolean {
  return rng.next() < chance;
}
