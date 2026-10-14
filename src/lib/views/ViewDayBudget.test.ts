import { describe, it, expect } from 'vitest';
import {
  rolloverViewDay,
  recordViewDay,
  recordViewDayEffect,
  remainingDailyViews,
  viewsPerDay,
  viewRunCap,
  DEFAULT_VIEWS_PER_DAY,
} from './ViewDayBudget';

const rng = (v: number) => ({ next: () => v });

describe('ViewDayBudget', () => {
  it('rolls a new day over to used:0', () => {
    expect(rolloverViewDay({ day: '2026-06-25', used: 9 }, '2026-06-26')).toEqual({
      day: '2026-06-26',
      used: 0,
    });
    expect(rolloverViewDay({ day: '2026-06-26', used: 9 }, '2026-06-26')).toEqual({
      day: '2026-06-26',
      used: 9,
    });
  });
  it('records and computes remaining', () => {
    expect(recordViewDay({ day: 'd', used: 5 }, 3)).toEqual({ day: 'd', used: 8 });
    expect(remainingDailyViews({ day: 'd', used: 8 }, 40)).toBe(32);
  });
  it('viewsPerDay reads the profile_views module limit, else default', () => {
    expect(viewsPerDay([{ id: 'profile_views', dailyLimit: 25 }])).toBe(25);
    expect(viewsPerDay(null)).toBe(DEFAULT_VIEWS_PER_DAY);
  });
  it('viewRunCap jitters DOWN, bounded by daily remaining', () => {
    expect(viewRunCap(40, 40, rng(1))).toBe(40); // rng=1 → no down-jitter
    expect(viewRunCap(5, 40, rng(1))).toBe(5); // bounded by remaining
    expect(viewRunCap(40, 40, rng(0))).toBeLessThan(40); // rng=0 → max down-jitter
  });

  it('deduplicates effects and ignores a replay from an older day', () => {
    const first = recordViewDayEffect({ day: '2026-08-11', used: 4 }, '2026-08-11', 'effect-1');
    expect(first).toEqual({ day: '2026-08-11', used: 5, effectIds: ['effect-1'] });
    expect(recordViewDayEffect(first, '2026-08-11', 'effect-1')).toEqual(first);
    const newer = { day: '2026-08-12', used: 1, effectIds: ['new'] };
    expect(recordViewDayEffect(newer, '2026-08-11', 'late')).toBe(newer);
  });
});
