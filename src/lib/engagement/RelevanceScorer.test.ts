import { describe, it, expect } from 'vitest';
import { RelevanceScorer } from './RelevanceScorer';
import type { FeedPost, TargetProfile } from '@lib/types';

const profile: TargetProfile = {
  stack: ['Vue', 'TypeScript'],
  targetRoles: ['recruiter', 'talent'],
  geos: ['remote'],
  watchlistCompanies: ['Acme'],
};

const post = (over: Partial<FeedPost>): FeedPost => ({
  urn: 'urn:li:activity:1',
  authorName: 'Anna',
  authorHeadline: '',
  text: '',
  ...over,
});

describe('RelevanceScorer', () => {
  const scorer = new RelevanceScorer();

  it('scores 0 for a post matching nothing in the profile', () => {
    expect(scorer.score(post({ text: 'cooking pasta tonight' }), profile)).toBe(0);
  });

  it('weights a recruiter-role headline highest', () => {
    const s = scorer.score(post({ authorHeadline: 'Senior Technical Recruiter at Foo' }), profile);
    expect(s).toBeCloseTo(0.5);
  });

  it('adds a stack signal on top of role', () => {
    const s = scorer.score(
      post({ authorHeadline: 'Recruiter at Foo', text: 'We need a Vue engineer' }),
      profile,
    );
    expect(s).toBeCloseTo(0.8); // role 0.5 + stack 0.3
  });

  it('reaches 1.0 when role, stack, company and geo all match', () => {
    const s = scorer.score(
      post({
        authorHeadline: 'Talent partner at Acme, remote-first',
        text: 'Hiring a TypeScript developer',
      }),
      profile,
    );
    expect(s).toBeCloseTo(1.0); // 0.5 + 0.3 + 0.15 + 0.05
  });

  it('matches case-insensitively', () => {
    const s = scorer.score(post({ text: 'love VUE and typescript' }), profile);
    expect(s).toBeCloseTo(0.3);
  });

  it('counts a signal once even if it matches multiple terms', () => {
    const s = scorer.score(post({ text: 'Vue and TypeScript both' }), profile);
    expect(s).toBeCloseTo(0.3); // stack signal is boolean, not per-term
  });

  it('isRelevant is true at the threshold boundary', () => {
    const stackOnly = post({ text: 'Vue rocks' });
    expect(scorer.score(stackOnly, profile)).toBeCloseTo(0.3);
    expect(scorer.isRelevant(stackOnly, profile, 0.3)).toBe(true);
    expect(scorer.isRelevant(stackOnly, profile, 0.31)).toBe(false);
  });
});
