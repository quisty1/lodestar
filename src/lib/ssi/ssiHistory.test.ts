import { describe, it, expect } from 'vitest';
import { upsertDailySnapshot, dayKey } from './ssiHistory';
import type { SsiSnapshot } from '../types';

function snap(total: number, at: string): SsiSnapshot {
  return { total, pillars: [], capturedAt: at };
}

describe('dayKey', () => {
  it('buckets an ISO timestamp by UTC calendar day', () => {
    expect(dayKey('2026-06-23T10:00:00.000Z')).toBe('2026-06-23');
    expect(dayKey('2026-06-23T23:59:59.000Z')).toBe('2026-06-23');
  });

  it('keys invalid dates by their raw string (stays unique)', () => {
    expect(dayKey('a')).toBe('a');
    expect(dayKey('b')).toBe('b');
  });
});

describe('upsertDailySnapshot', () => {
  it('adds the first snapshot', () => {
    const out = upsertDailySnapshot(null, snap(60, '2026-06-21T10:00:00Z'));
    expect(out.map((s) => s.total)).toEqual([60]);
  });

  it('keeps one entry per day — latest capture wins', () => {
    let h = upsertDailySnapshot([], snap(60, '2026-06-23T08:00:00Z'));
    h = upsertDailySnapshot(h, snap(64, '2026-06-23T20:00:00Z')); // same day, later
    expect(h).toHaveLength(1);
    expect(h[0].total).toBe(64);
  });

  it('accumulates distinct days sorted oldest→newest', () => {
    let h = upsertDailySnapshot([], snap(58, '2026-06-21T10:00:00Z'));
    h = upsertDailySnapshot(h, snap(62, '2026-06-23T10:00:00Z'));
    h = upsertDailySnapshot(h, snap(60, '2026-06-22T10:00:00Z')); // out-of-order insert
    expect(h.map((s) => s.total)).toEqual([58, 60, 62]);
  });

  it('caps to the last N days, keeping the newest', () => {
    let h: SsiSnapshot[] = [];
    for (const d of ['20', '21', '22', '23', '24']) {
      h = upsertDailySnapshot(h, snap(Number(d), `2026-06-${d}T10:00:00Z`), 3);
    }
    expect(h.map((s) => s.total)).toEqual([22, 23, 24]);
  });

  it('tolerates a corrupt (non-array) stored value', () => {
    const out = upsertDailySnapshot('garbage', snap(70, '2026-06-23T10:00:00Z'));
    expect(out.map((s) => s.total)).toEqual([70]);
  });
});
