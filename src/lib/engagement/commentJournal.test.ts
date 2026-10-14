import { describe, expect, it } from 'vitest';
import { isoWeekKey } from '../content/PostWeekBudget';
import { appendCommentJournal, commentsInWeek } from './commentJournal';

describe('comment journal', () => {
  it('keeps the newest comment and ignores a repeat on the same post', () => {
    const first = appendCommentJournal(null, {
      id: '1',
      text: 'Why this tradeoff?',
      author: 'Ann',
      postUrn: 'urn:1',
      at: '2026-08-11T10:00:00Z',
    });
    const again = appendCommentJournal(first, {
      id: '2',
      text: 'Again',
      author: 'Ann',
      postUrn: 'urn:1',
      at: '2026-08-11T11:00:00Z',
    });
    expect(again).toHaveLength(1);
    expect(again[0].text).toBe('Why this tradeoff?');
  });

  it('counts comments inside one ISO week', () => {
    const entries = [
      { id: '1', text: 'a', author: 'A', postUrn: '1', at: '2026-08-11T10:00:00Z' },
      { id: '2', text: 'b', author: 'B', postUrn: '2', at: '2026-07-01T10:00:00Z' },
    ];
    expect(commentsInWeek(entries, isoWeekKey(new Date('2026-08-11T10:00:00Z')))).toBe(1);
  });
});
