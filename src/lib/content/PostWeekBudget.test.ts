import { describe, it, expect } from 'vitest';
import {
  isoWeekKey,
  rolloverPostWeek,
  recordPostWeek,
  recordPostWeekEffect,
  remainingPosts,
  type PostWeek,
} from './PostWeekBudget';

describe('isoWeekKey', () => {
  it('formats ISO-8601 year-week', () => {
    expect(isoWeekKey(new Date('2026-06-26T00:00:00Z'))).toBe('2026-W26');
  });
  it('puts 2027-01-01 (Friday) in week 53 of 2026 per ISO-8601', () => {
    expect(isoWeekKey(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
  });
});

describe('post week budget', () => {
  it('rolls over to a fresh week (used reset) but keeps the same-week count', () => {
    const prev: PostWeek = { week: '2026-W25', used: 2 };
    expect(rolloverPostWeek(prev, '2026-W26')).toEqual({ week: '2026-W26', used: 0 });
    expect(rolloverPostWeek(prev, '2026-W25')).toBe(prev);
  });
  it('records usage and computes remaining against the limit', () => {
    const s = recordPostWeek({ week: '2026-W26', used: 0 }, 1);
    expect(s.used).toBe(1);
    expect(remainingPosts(s, 3)).toBe(2);
    expect(remainingPosts({ week: '2026-W26', used: 3 }, 3)).toBe(0);
  });

  it('deduplicates an effect and never rolls a newer counter backwards', () => {
    const first = recordPostWeekEffect({ week: '2026-W33', used: 1 }, '2026-W33', 'effect-1');
    expect(first).toEqual({ week: '2026-W33', used: 2, effectIds: ['effect-1'] });
    expect(recordPostWeekEffect(first, '2026-W33', 'effect-1')).toEqual(first);
    const newer = { week: '2026-W34', used: 2, effectIds: ['new'] };
    expect(recordPostWeekEffect(newer, '2026-W33', 'late')).toBe(newer);
  });
});
