import { describe, it, expect } from 'vitest';
import { DailyCeiling } from './DailyCeiling';
import type { Rng } from '@lib/ports';

const rng = (v: number): Rng => ({ next: () => v });

describe('DailyCeiling', () => {
  const ceiling = new DailyCeiling({ base: 40, jitter: 10, warmupDays: 14 });

  it('returns base - jitter at rng 0', () => {
    expect(ceiling.forDay(rng(0))).toBe(30);
  });

  it('returns base + jitter at rng 1', () => {
    expect(ceiling.forDay(rng(1))).toBe(50);
  });

  it('returns base at rng 0.5', () => {
    expect(ceiling.forDay(rng(0.5))).toBe(40);
  });

  it('scales down linearly during warmup (day 7 of 14 ~ half)', () => {
    // base 40 at rng .5, warmupDay 7 of 14 → round(40 * 7/14) = 20
    expect(ceiling.forDay(rng(0.5), 7)).toBe(20);
  });

  it('never returns below 1 even on day 0 of warmup', () => {
    expect(ceiling.forDay(rng(0), 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('DailyCeiling base from config', () => {
  it('centres the jittered ceiling on the configured base', () => {
    const c = new DailyCeiling({ base: 35, jitter: 10 });
    expect(c.forDay(rng(0.5))).toBe(35); // centre
    expect(c.forDay(rng(0))).toBe(25); // base - jitter
    expect(c.forDay(rng(1))).toBe(45); // base + jitter
  });
});
