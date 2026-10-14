import type { FeedPost, TargetProfile } from '../types';
import { RelevanceScorer } from './RelevanceScorer';

const PROMO_PHRASES = [
  'link in comments',
  'dm me',
  'promo code',
  'giveaway',
  'sponsored',
  'use code',
  'sign up now',
];
const MIN_TEXT = 8;
const MAX_HASHTAGS = 6;

export interface LikeVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Broad "is this worth a like?" filter. A like is cheap and
 * reversible, so we like widely and only skip obvious junk. Targeting by stack is
 * a *sort key* here (relevant first when budget is tight), never a gate — that
 * belongs to comments. Pure.
 */
export class LikeFilter {
  private readonly scorer = new RelevanceScorer();

  worthLiking(post: FeedPost, ownerName?: string): LikeVerdict {
    // Never like/comment your OWN posts. Matching by author NAME (from the control-menu
    // anchor) is immune to the componentkey churn that defeated urn-dedup live, where an
    // auto-published post got self-liked + commented ×3 (2026-06-29).
    if (ownerName && post.authorName === ownerName) return { ok: false, reason: 'own_post' };
    if (post.alreadyLiked) return { ok: false, reason: 'already_liked' };
    const text = post.text.trim();
    if (text.length < MIN_TEXT) return { ok: false, reason: 'empty' };
    const lower = text.toLowerCase();
    if (PROMO_PHRASES.some((p) => lower.includes(p))) return { ok: false, reason: 'promo' };
    if ((text.match(/#/g) ?? []).length >= MAX_HASHTAGS)
      return { ok: false, reason: 'hashtag_wall' };
    return { ok: true };
  }

  select(
    posts: FeedPost[],
    profile?: TargetProfile,
    ownerName?: string,
  ): { likeable: FeedPost[]; skipped: { urn: string; reason: string }[] } {
    const likeable: FeedPost[] = [];
    const skipped: { urn: string; reason: string }[] = [];
    for (const post of posts) {
      const verdict = this.worthLiking(post, ownerName);
      if (verdict.ok) likeable.push(post);
      else skipped.push({ urn: post.urn, reason: verdict.reason ?? 'skip' });
    }
    if (profile) {
      likeable.sort((a, b) => this.scorer.score(b, profile) - this.scorer.score(a, profile));
    }
    return { likeable, skipped };
  }
}
