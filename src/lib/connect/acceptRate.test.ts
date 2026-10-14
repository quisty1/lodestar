import { describe, expect, it } from 'vitest';
import { acceptRate, matchAcceptedIds } from './acceptRate';

const now = new Date('2026-08-20T12:00:00Z');

describe('acceptRate', () => {
  it('stays unknown until a scan exists, even when invites were sent', () => {
    const rate = acceptRate([{ memberId: '1', sentAt: '2026-08-10T00:00:00Z' }], null, now);
    expect(rate).toMatchObject({ sent: 1, accepted: null, rate: null });
  });

  it('counts only invites inside the window after a scan', () => {
    const rate = acceptRate(
      [
        { memberId: 'new', sentAt: '2026-08-01T00:00:00Z' },
        { memberId: 'old', sentAt: '2026-06-01T00:00:00Z' },
        { memberId: 'yes', sentAt: '2026-08-12T00:00:00Z' },
      ],
      new Set(['yes']),
      now,
      28,
    );
    expect(rate).toMatchObject({ sent: 2, accepted: 1, rate: 0.5 });
  });
});

describe('matchAcceptedIds', () => {
  it('matches by member id, profile url, or name', () => {
    const ids = matchAcceptedIds(
      [
        { memberId: 'a', sentAt: '', name: 'Ann', profileUrl: 'https://www.linkedin.com/in/ann/' },
        { memberId: 'b', sentAt: '', name: 'Bob' },
      ],
      [{ profileUrl: 'https://www.linkedin.com/in/ann' }, { name: 'Bob' }],
    );
    expect(ids.sort()).toEqual(['a', 'b']);
  });
});
