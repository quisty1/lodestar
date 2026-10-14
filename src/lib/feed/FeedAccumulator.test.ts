import { describe, it, expect } from 'vitest';
import { FeedAccumulator } from './FeedAccumulator';
import type { FeedPost } from '@lib/types';

const post = (urn: string, text = 'x'): FeedPost => ({ urn, authorName: 'a', text });

describe('FeedAccumulator', () => {
  it('adds new posts and returns the count newly added', () => {
    const acc = new FeedAccumulator();
    expect(acc.add([post('1'), post('2')])).toBe(2);
    expect(acc.size()).toBe(2);
  });

  it('dedups by urn across rounds, counting only the new ones', () => {
    const acc = new FeedAccumulator();
    acc.add([post('1'), post('2')]);
    expect(acc.add([post('2'), post('3')])).toBe(1); // only '3' is new
    expect(acc.items().map((p) => p.urn)).toEqual(['1', '2', '3']);
  });

  it('preserves first-seen order and content', () => {
    const acc = new FeedAccumulator();
    acc.add([post('1', 'first')]);
    acc.add([post('1', 'changed')]); // ignored — already seen
    expect(acc.items()[0].text).toBe('first');
  });
});
