import { describe, it, expect } from 'vitest';
import { HumanBreakPolicy } from './HumanBreakPolicy';
import type { Rng } from '@lib/ports';

const rng = (v: number): Rng => ({ next: () => v });

describe('HumanBreakPolicy', () => {
  // break every 6–10 actions; break length 60–180s
  const policy = new HumanBreakPolicy({
    everyMin: 6,
    everyMax: 10,
    breakMinMs: 60_000,
    breakMaxMs: 180_000,
  });

  it('no break before the minimum action count', () => {
    expect(policy.nextBreakMs(5, rng(0))).toBe(0);
  });

  it('takes a break once the drawn threshold is reached (rng 0 → threshold 6)', () => {
    const ms = policy.nextBreakMs(6, rng(0));
    expect(ms).toBe(60_000); // rng 0 → min break length
  });

  it('break length spans the configured range (rng 1 → max)', () => {
    expect(policy.nextBreakMs(10, rng(1))).toBe(180_000);
  });
});
