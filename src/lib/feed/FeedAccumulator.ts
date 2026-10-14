import type { FeedPost } from '../types';

/** Collects feed posts across scroll rounds, deduped by urn, first-seen order. */
export class FeedAccumulator {
  private readonly seen = new Set<string>();
  private readonly list: FeedPost[] = [];

  /** Add a round of posts; returns how many were newly added (not seen before). */
  add(posts: FeedPost[]): number {
    let added = 0;
    for (const post of posts) {
      if (this.seen.has(post.urn)) continue;
      this.seen.add(post.urn);
      this.list.push(post);
      added++;
    }
    return added;
  }

  size(): number {
    return this.list.length;
  }

  items(): FeedPost[] {
    return [...this.list];
  }
}
