import { describe, it, expect } from 'vitest';
import { computeViewsProgress } from './profileViewsProgress';
import type { ProfileViewsSnapshot } from '../types';

const snap = (count: number, at: string, windowDays = 90): ProfileViewsSnapshot => ({
  count,
  windowDays,
  capturedAt: at,
});

describe('computeViewsProgress', () => {
  it('empty history → no baseline, empty series', () => {
    const p = computeViewsProgress([]);
    expect(p.hasBaseline).toBe(false);
    expect(p.from).toBeNull();
    expect(p.to).toBeNull();
    expect(p.values).toEqual([]);
    expect(p.countDelta).toBe(0);
  });

  it('single snapshot → no baseline but still reports the current count', () => {
    const p = computeViewsProgress([snap(45, '2026-07-02T10:00:00Z')]);
    expect(p.hasBaseline).toBe(false);
    expect(p.countTo).toBe(45);
    expect(p.values).toEqual([45]);
    expect(p.windowDays).toBe(90);
    expect(p.spanDays).toBe(0);
  });

  it('baseline→latest: delta, span, and series oldest→newest', () => {
    const p = computeViewsProgress([
      snap(40, '2026-06-28T10:00:00Z'),
      snap(45, '2026-07-02T10:00:00Z'),
    ]);
    expect(p.hasBaseline).toBe(true);
    expect(p.countFrom).toBe(40);
    expect(p.countTo).toBe(45);
    expect(p.countDelta).toBe(5);
    expect(p.spanDays).toBe(4);
    expect(p.values).toEqual([40, 45]);
  });

  it('reports a negative delta honestly (a rolling window can legitimately drop)', () => {
    const p = computeViewsProgress([
      snap(50, '2026-06-28T10:00:00Z'),
      snap(45, '2026-07-02T10:00:00Z'),
    ]);
    expect(p.countDelta).toBe(-5);
  });

  it('windowDays reflects the latest snapshot (honest "за N дней" label)', () => {
    const p = computeViewsProgress([
      snap(30, '2026-06-01T10:00:00Z', 90),
      snap(45, '2026-07-02T10:00:00Z', 90),
    ]);
    expect(p.windowDays).toBe(90);
  });
});
