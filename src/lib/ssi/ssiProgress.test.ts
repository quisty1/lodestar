import { describe, it, expect } from 'vitest';
import { computeProgress, windowedDelta, pillarSeries } from './ssiProgress';
import type { SsiSnapshot, SsiPillar } from '../types';

function pillars(brand: number, people: number, insights: number, rel: number): SsiPillar[] {
  return [
    { key: 'brand', label: 'Бренд', score: brand },
    { key: 'people', label: 'Люди', score: people },
    { key: 'insights', label: 'Инсайты', score: insights },
    { key: 'relationships', label: 'Связи', score: rel },
  ];
}

function snap(total: number, at: string, p = pillars(0, 0, 0, 0)): SsiSnapshot {
  return { total, pillars: p, capturedAt: at };
}

describe('computeProgress', () => {
  it('reports no baseline for empty history', () => {
    const p = computeProgress([]);
    expect(p.hasBaseline).toBe(false);
    expect(p.from).toBeNull();
    expect(p.to).toBeNull();
  });

  it('reports no baseline for a single snapshot but exposes latest', () => {
    const p = computeProgress([snap(20, '2026-06-23T10:00:00Z')]);
    expect(p.hasBaseline).toBe(false);
    expect(p.to?.total).toBe(20);
    expect(p.totalDelta).toBe(0);
  });

  it('computes baseline→latest total delta and span', () => {
    const h = [snap(19.7, '2026-06-10T10:00:00Z'), snap(24.5, '2026-06-24T10:00:00Z')];
    const p = computeProgress(h);
    expect(p.hasBaseline).toBe(true);
    expect(p.totalFrom).toBe(19.7);
    expect(p.totalTo).toBe(24.5);
    expect(p.totalDelta).toBe(4.8);
    expect(p.spanDays).toBe(14);
  });

  it('computes per-pillar deltas', () => {
    const h = [
      snap(40, '2026-06-10T10:00:00Z', pillars(13, 4, 0.3, 2.6)),
      snap(50, '2026-06-24T10:00:00Z', pillars(15, 6, 2.3, 5.6)),
    ];
    const brand = computeProgress(h).pillars.find((x) => x.key === 'brand')!;
    expect(brand.from).toBe(13);
    expect(brand.to).toBe(15);
    expect(brand.delta).toBe(2);
    const insights = computeProgress(h).pillars.find((x) => x.key === 'insights')!;
    expect(insights.delta).toBe(2);
  });
});

describe('windowedDelta', () => {
  it('returns null with fewer than two snapshots', () => {
    expect(windowedDelta([], 14)).toBeNull();
    expect(windowedDelta([snap(20, '2026-06-24T10:00:00Z')], 14)).toBeNull();
  });

  it('measures change from the earliest snapshot inside the window', () => {
    const h = [
      snap(10, '2026-06-01T10:00:00Z'), // outside 14d window
      snap(18, '2026-06-14T10:00:00Z'), // inside
      snap(22, '2026-06-24T10:00:00Z'), // latest
    ];
    const d = windowedDelta(h, 14)!;
    expect(d.delta).toBe(4); // 22 − 18, not 22 − 10
    expect(d.days).toBe(10);
  });

  it('falls back to full span when history is shorter than the window', () => {
    const h = [snap(15, '2026-06-20T10:00:00Z'), snap(21, '2026-06-24T10:00:00Z')];
    const d = windowedDelta(h, 30)!;
    expect(d.delta).toBe(6);
    expect(d.days).toBe(4);
  });
});

describe('pillarSeries', () => {
  it('builds one score series per pillar in history order', () => {
    const h = [
      snap(40, '2026-06-10T10:00:00Z', pillars(13, 4, 0, 2)),
      snap(50, '2026-06-24T10:00:00Z', pillars(15, 6, 2, 5)),
    ];
    const series = pillarSeries(h);
    expect(series.find((s) => s.key === 'brand')!.values).toEqual([13, 15]);
    expect(series.find((s) => s.key === 'people')!.values).toEqual([4, 6]);
  });

  it('is empty for empty history', () => {
    expect(pillarSeries([])).toEqual([]);
  });
});
