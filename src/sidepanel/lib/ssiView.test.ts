import { describe, it, expect } from 'vitest';
import { pillarsToView } from './ssiView';
import type { SsiSnapshot } from '@lib/types';

const snap: SsiSnapshot = {
  total: 72,
  pillars: [
    { key: 'brand', label: 'Бренд', score: 19 },
    { key: 'people', label: 'Люди', score: 17 },
    { key: 'insights', label: 'Инсайты', score: 21 },
    { key: 'relationships', label: 'Связи', score: 15 },
  ],
  capturedAt: '2026-06-23T10:00:00.000Z',
};

describe('pillarsToView', () => {
  it('formats score as N/25', () => {
    expect(pillarsToView(snap)[0].score).toBe('19/25');
  });

  it('computes width percentage of 25', () => {
    expect(pillarsToView(snap)[0].pct).toBe(76); // 19/25 = 76%
    expect(pillarsToView(snap)[3].pct).toBe(60); // 15/25 = 60%
  });

  it('uses one neutral solid accent per pillar', () => {
    const grads = pillarsToView(snap).map((p) => p.gradient);
    expect(grads.every((fill) => fill === 'var(--accent)')).toBe(true);
  });

  it('rounds fractional scores', () => {
    const frac = {
      ...snap,
      pillars: [{ key: 'brand' as const, label: 'B', score: 18.6 }],
    };
    expect(pillarsToView(frac)[0].score).toBe('19/25');
  });
});
