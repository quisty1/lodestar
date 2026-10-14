import { describe, it, expect } from 'vitest';
import { HumanDelay } from './HumanDelay';
import type { Rng } from '@lib/ports';

const fixedRng = (value: number): Rng => ({ next: () => value });

describe('HumanDelay', () => {
  it('returns the minimum when rng yields 0', () => {
    const delay = new HumanDelay(fixedRng(0));
    expect(delay.nextMs(8000, 45000)).toBe(8000);
  });

  it('returns the maximum when rng yields 1', () => {
    const delay = new HumanDelay(fixedRng(1));
    expect(delay.nextMs(8000, 45000)).toBe(45000);
  });

  it('returns the midpoint when rng yields 0.5', () => {
    const delay = new HumanDelay(fixedRng(0.5));
    expect(delay.nextMs(8000, 45000)).toBe(26500);
  });

  it('stays within [min, max] for an arbitrary rng value', () => {
    const delay = new HumanDelay(fixedRng(0.137));
    const ms = delay.nextMs(8000, 45000);
    expect(ms).toBeGreaterThanOrEqual(8000);
    expect(ms).toBeLessThanOrEqual(45000);
  });
});
