import { describe, it, expect } from 'vitest';
import { ScrollHarvestPolicy, type ScrollState } from './ScrollHarvestPolicy';

const s = (over: Partial<ScrollState>): ScrollState => ({
  collected: 0,
  target: 25,
  staleRounds: 0,
  round: 0,
  ...over,
});

describe('ScrollHarvestPolicy', () => {
  const policy = new ScrollHarvestPolicy({ maxStaleRounds: 2, maxRounds: 15 });

  it('stops once the target count is reached', () => {
    expect(policy.shouldStop(s({ collected: 25 }))).toBe(true);
    expect(policy.shouldStop(s({ collected: 24 }))).toBe(false);
  });

  it('stops after too many stale rounds (feed exhausted)', () => {
    expect(policy.shouldStop(s({ collected: 5, staleRounds: 2 }))).toBe(true);
    expect(policy.shouldStop(s({ collected: 5, staleRounds: 1 }))).toBe(false);
  });

  it('stops at the hard round cap', () => {
    expect(policy.shouldStop(s({ collected: 5, round: 15 }))).toBe(true);
    expect(policy.shouldStop(s({ collected: 5, round: 14 }))).toBe(false);
  });
});
