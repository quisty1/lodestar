import { it, expect } from 'vitest';
import { shouldPublishToday, pickOldestApproved } from './publishPolicy';
import type { Draft } from '../types';

const base = { weekday: 1, publishDays: [1, 3, 5], remainingPosts: 1, hasApproved: true };
it('publishes only when weekday matches, budget left, and an approved draft exists', () => {
  expect(shouldPublishToday(base)).toBe(true);
  expect(shouldPublishToday({ ...base, weekday: 2 })).toBe(false); // not a publish day
  expect(shouldPublishToday({ ...base, remainingPosts: 0 })).toBe(false); // cap spent
  expect(shouldPublishToday({ ...base, hasApproved: false })).toBe(false);
});

const d = (id: string, createdAt: string, approved?: boolean): Draft => ({
  id,
  ideaTopic: 't',
  ideaAngle: 'a',
  text: id,
  createdAt,
  approved,
});
it('picks the oldest approved draft by createdAt, ignoring un-approved', () => {
  const drafts = [
    d('new', '2026-06-26T03:00:00Z', true),
    d('old', '2026-06-26T01:00:00Z', true),
    d('x', '2026-06-26T00:00:00Z', false),
  ];
  expect(pickOldestApproved(drafts)?.id).toBe('old');
  expect(pickOldestApproved([d('x', '2026-06-26T00:00:00Z', false)])).toBeNull();
  expect(
    pickOldestApproved([{ ...d('media', '2026-06-26T00:00:00Z', true), mediaAttached: false }]),
  ).toBeNull();
  expect(
    pickOldestApproved([{ ...d('repost', '2026-06-26T00:00:00Z', true), kind: 'repost' }]),
  ).toBeNull();
});
