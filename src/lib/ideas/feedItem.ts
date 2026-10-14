import type { FeedItem, FeedPost } from '../types';

/** Reuse the engagement harvest (FeedPost) as idea signal — text is richer than excerpt. */
export function feedPostToFeedItem(post: FeedPost): FeedItem {
  return { id: post.urn, author: post.authorName, excerpt: post.text };
}
