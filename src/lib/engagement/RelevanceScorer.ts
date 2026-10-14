import type { FeedPost, TargetProfile } from '../types';

/**
 * Scores how relevant a feed post is for engagement (a like), using the target profile:
 * a post from a recruiter / matching the user's stack / company / geo is worth
 * engaging. Pure — no DOM, no chrome, no randomness — so it's trivially testable.
 *
 * Each criterion contributes once (boolean hit, not per-term), weights sum to 1.0.
 * The author *role* is read from the headline only (it describes the author),
 * while stack/company/geo can appear anywhere in headline or body.
 */
export class RelevanceScorer {
  private static readonly WEIGHTS = {
    role: 0.5,
    stack: 0.3,
    company: 0.15,
    geo: 0.05,
  } as const;

  score(post: FeedPost, profile: TargetProfile): number {
    const headline = (post.authorHeadline ?? '').toLowerCase();
    const all = `${headline} ${post.text.toLowerCase()}`;

    let score = 0;
    const { WEIGHTS } = RelevanceScorer;
    if (this.hits(headline, profile.targetRoles)) score += WEIGHTS.role;
    if (this.hits(all, profile.stack)) score += WEIGHTS.stack;
    if (this.hits(all, profile.watchlistCompanies)) score += WEIGHTS.company;
    if (this.hits(all, profile.geos)) score += WEIGHTS.geo;
    return Math.min(1, score);
  }

  isRelevant(post: FeedPost, profile: TargetProfile, threshold: number): boolean {
    return this.score(post, profile) >= threshold;
  }

  private hits(haystack: string, terms: string[]): boolean {
    return terms.some((t) => t.length > 0 && haystack.includes(t.toLowerCase()));
  }
}
