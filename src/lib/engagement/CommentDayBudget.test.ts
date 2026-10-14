import { describe, expect, it } from 'vitest';
import { COMMENT_ACTED_KEY, COMMENT_BUDGET_KEY, recordCommentDayEffect } from './CommentDayBudget';

describe('CommentDayBudget', () => {
  it('exports shared storage keys and records each effect once', () => {
    expect(COMMENT_BUDGET_KEY).toBe('comments:budget');
    expect(COMMENT_ACTED_KEY).toBe('comments:acted');
    const first = recordCommentDayEffect({ day: '2026-08-11', used: 3 }, '2026-08-11', 'effect-1');
    expect(first).toEqual({ day: '2026-08-11', used: 4, effectIds: ['effect-1'] });
    expect(recordCommentDayEffect(first, '2026-08-11', 'effect-1')).toEqual(first);
  });

  it('ignores a late effect from an older day', () => {
    const newer = { day: '2026-08-12', used: 2, effectIds: ['new'] };
    expect(recordCommentDayEffect(newer, '2026-08-11', 'late')).toBe(newer);
  });
});
