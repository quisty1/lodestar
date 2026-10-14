import { describe, expect, it } from 'vitest';
import { weeklyMinimum } from './weeklyMinimum';

describe('weeklyMinimum', () => {
  it('counts each floor once', () => {
    expect(weeklyMinimum({ posts: 0, comments: 2, reactions: 40 })).toEqual({
      posts: false,
      comments: true,
      reactions: true,
      done: 2,
      total: 3,
    });
    expect(weeklyMinimum({ posts: 1, comments: 1, reactions: 1 }).done).toBe(3);
  });
});
