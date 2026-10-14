import { describe, it, expect } from 'vitest';
import { rollComment } from './commentRoll';
import type { Rng } from '../ports';

const rng = (v: number): Rng => ({ next: () => v });

describe('rollComment', () => {
  it('rolls true below the chance threshold', () => {
    expect(rollComment(rng(0.1))).toBe(true);
    expect(rollComment(rng(0.32))).toBe(true); // just under 1/3
  });

  it('rolls false at/above the chance threshold', () => {
    expect(rollComment(rng(0.34))).toBe(false);
    expect(rollComment(rng(0.9))).toBe(false);
  });

  it('honours a custom chance', () => {
    expect(rollComment(rng(0.2), 0.5)).toBe(true);
    expect(rollComment(rng(0.6), 0.5)).toBe(false);
  });
});
