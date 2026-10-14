import { describe, it, expect, beforeEach } from 'vitest';
import { FeedReader } from '@lib/feed/FeedReader';
import { LikeFilter } from '@lib/engagement/LikeFilter';
import { readOwnerName } from './readOwner';

// Boundary test for the live self-engagement bug (2026-06-29): the bot auto-published
// Vlad's post, then liked it AND wrote 3 comments UNDER it. This crosses the real DOM
// seam end-to-end — owner identity (readOwnerName) + post extraction (FeedReader) +
// the like/comment gate (LikeFilter) — proving the own post is dropped before any action.
//
// The owner identity mirrors the hydrated RSC feed captured 2026-08-11: an unrelated
// feed-author profile link may precede the stable sharebox anchor, whose blank image is
// paired with an accessible SVG name. Each post root has a control-menu author + one
// reaction button. The own post is rendered under BOTH a base key and an
// "expanded…FeedType…" key (LinkedIn's churn that defeated urn-dedup live → 3 comments)
// — the NAME match drops every variant regardless.
const FEED = `
<a href="https://www.linkedin.com/in/jane-recruiter/"><img alt="Jane Recruiter" /></a>
<div id="shareboxProfilePictureComponentRef">
  <a href="https://www.linkedin.com/in/example-owner/">
    <img alt="" />
    <figure><svg role="img" aria-label="Alex  Morgan "></svg></figure>
  </a>
</div>
<div componentkey="container">
  <div componentkey="OWN_1">
    <button aria-label="Open control menu for post by Alex Morgan">⋯</button>
    <div data-testid="expandable-text-box">Sharing my thoughts on frontend leadership today.</div>
    <button aria-label="Reaction button state: no reaction">React</button>
    <button aria-label="Comment">Comment</button>
  </div>
  <div componentkey="expandedOWN_1FeedType_MAIN_FEED_RELEVANCE">
    <button aria-label="Open control menu for post by Alex Morgan">⋯</button>
    <div data-testid="expandable-text-box">Sharing my thoughts on frontend leadership today.</div>
    <button aria-label="Reaction button state: no reaction">React</button>
    <button aria-label="Comment">Comment</button>
  </div>
  <div componentkey="OTHER_1">
    <button aria-label="Open control menu for post by Jane Recruiter">⋯</button>
    <div data-testid="expandable-text-box">Hiring a senior Vue engineer, remote.</div>
    <button aria-label="Reaction button state: no reaction">React</button>
    <button aria-label="Comment">Comment</button>
  </div>
</div>`;

describe('own-post filter (DOM boundary)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = FEED;
  });

  it('never likes or comments the owner’s own post, keeps other authors', () => {
    const ownerName = readOwnerName(root);
    expect(ownerName).toBe('Alex Morgan');

    const posts = new FeedReader().parse(root);
    const { likeable, skipped } = new LikeFilter().select(posts, undefined, ownerName ?? undefined);

    expect(likeable.map((p) => p.authorName)).toEqual(['Jane Recruiter']);
    expect(skipped).toContainEqual({ urn: 'OWN_1', reason: 'own_post' });
  });
});
