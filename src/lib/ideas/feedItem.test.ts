import { describe, it, expect } from 'vitest';
import { feedPostToFeedItem } from './feedItem';
import type { FeedPost } from '@lib/types';

describe('feedPostToFeedItem', () => {
  it('maps urn/authorName/text to id/author/excerpt', () => {
    const post: FeedPost = {
      urn: 'urn:li:activity:1',
      authorName: 'Anna K',
      text: 'Hiring Vue devs',
    };
    expect(feedPostToFeedItem(post)).toEqual({
      id: 'urn:li:activity:1',
      author: 'Anna K',
      excerpt: 'Hiring Vue devs',
    });
  });
});
