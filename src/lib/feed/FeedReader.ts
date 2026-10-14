import type { FeedPost } from '../types';
import {
  findPostAuthor,
  findReactionControl,
  isFeedPostRoot,
  reactionState,
} from '../linkedin/domContract';

// Stable anchors discovered on the live LinkedIn feed (new hashed-class build,
// 2026-06-24). The DOM exposes no urn and no semantic classes, so we key off
// aria-labels, a `componentkey` (per-post id), and a `data-testid` text box.
const TEXT_BOX = '[data-testid="expandable-text-box"]';

/**
 * Reads posts from the LinkedIn feed DOM (engagement module). SRP: extraction
 * only — it never likes, comments or mutates the page. Pure w.r.t. a given root,
 * so it's unit-tested against a fixture mirroring the real structure, and
 * deduplicates virtualised re-renders by `componentkey`.
 */
export class FeedReader {
  parse(root: ParentNode, limit = Number.POSITIVE_INFINITY): FeedPost[] {
    const seen = new Set<string>();
    const posts: FeedPost[] = [];
    for (const el of root.querySelectorAll('[componentkey]')) {
      if (posts.length >= limit) break;
      if (!isFeedPostRoot(el)) continue;
      const post = this.toPost(el);
      if (!post || seen.has(post.urn)) continue;
      seen.add(post.urn);
      posts.push(post);
    }
    return posts;
  }

  /** Locate the (visible) post element for a urn, to act on it (like/comment). */
  findByUrn(root: ParentNode, urn: string): Element | null {
    const matches: Element[] = [];
    for (const el of root.querySelectorAll('[componentkey]')) {
      if (isFeedPostRoot(el) && normaliseUrn(el.getAttribute('componentkey')) === urn)
        matches.push(el);
    }
    // A post renders multiple times (base + hidden "expanded" copies); act on the
    // visible one so the click doesn't land on an offscreen measurement node.
    return matches.find((el) => (el as HTMLElement).offsetParent !== null) ?? matches[0] ?? null;
  }

  private toPost(el: Element): FeedPost | null {
    const urn = normaliseUrn(el.getAttribute('componentkey'));
    const authorName = findPostAuthor(el);
    if (!urn || !authorName) return null;

    const reaction = findReactionControl(el);
    const state = reaction ? reactionState(reaction) : 'unknown';

    return {
      urn,
      authorName,
      text: readText(el),
      ...(state === 'unknown' ? {} : { alreadyLiked: state === 'reacted' }),
    };
  }
}

/**
 * Each post renders under several componentkeys — a base key and
 * "expanded<base>FeedType_MAIN_FEED_RELEVANCE" variants. Strip the prefix and the
 * FeedType suffix so every render collapses onto one base urn.
 */
function normaliseUrn(raw: string | null): string {
  return (raw ?? '').replace(/^expanded/, '').replace(/FeedType_.*$/, '');
}

/** The post body, with the inline "…more" expander button stripped out. */
function readText(el: Element): string {
  const box = el.querySelector(TEXT_BOX);
  if (!box) return '';
  const clone = box.cloneNode(true) as Element;
  clone.querySelectorAll('button').forEach((b) => {
    b.remove();
  });
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}
