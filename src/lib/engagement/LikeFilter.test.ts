import { describe, it, expect } from 'vitest';
import { LikeFilter } from './LikeFilter';
import type { FeedPost, TargetProfile } from '@lib/types';

const post = (over: Partial<FeedPost>): FeedPost => ({
  urn: 'u',
  authorName: 'a',
  text: 'A normal, genuine professional post about work.',
  ...over,
});

describe('LikeFilter', () => {
  const filter = new LikeFilter();

  it('likes a normal post', () => {
    expect(filter.worthLiking(post({})).ok).toBe(true);
  });

  it('skips an already-liked post', () => {
    expect(filter.worthLiking(post({ alreadyLiked: true }))).toEqual({
      ok: false,
      reason: 'already_liked',
    });
  });

  it('skips an empty/too-short post', () => {
    expect(filter.worthLiking(post({ text: 'hi' })).reason).toBe('empty');
  });

  it('skips obvious promo/ads (case-insensitive)', () => {
    expect(filter.worthLiking(post({ text: 'Use code SAVE20 — sign up now!' })).reason).toBe(
      'promo',
    );
    expect(filter.worthLiking(post({ text: 'Full guide — Link in comments 👇' })).reason).toBe(
      'promo',
    );
  });

  it('skips a hashtag wall', () => {
    expect(filter.worthLiking(post({ text: 'launch #a #b #c #d #e #f #g' })).reason).toBe(
      'hashtag_wall',
    );
  });

  it('skips the owner’s OWN post (never like/comment yourself)', () => {
    // The live bug: an auto-published post sat atop the feed and got self-liked +
    // commented ×3. Matching by author NAME is immune to the componentkey churn that
    // defeated urn-dedup (every render of the post carries the same control-menu author).
    expect(filter.worthLiking(post({ authorName: 'Alex Morgan' }), 'Alex Morgan')).toEqual({
      ok: false,
      reason: 'own_post',
    });
  });

  it('still likes other people’s posts when an owner name is given', () => {
    expect(filter.worthLiking(post({ authorName: 'Jane Recruiter' }), 'Alex Morgan').ok).toBe(
      true,
    );
  });

  it('select drops every own-authored post, keeps the rest', () => {
    const out = filter.select(
      [
        post({ urn: '1', authorName: 'Jane Recruiter' }),
        post({ urn: '2', authorName: 'Alex Morgan' }),
        post({ urn: '3', authorName: 'Acme Corp' }),
      ],
      undefined,
      'Alex Morgan',
    );
    expect(out.likeable.map((p) => p.urn)).toEqual(['1', '3']);
    expect(out.skipped).toContainEqual({ urn: '2', reason: 'own_post' });
  });

  it('select splits likeable/skipped and orders stack-relevant first', () => {
    const profile: TargetProfile = {
      stack: ['Vue'],
      targetRoles: [],
      geos: [],
      watchlistCompanies: [],
    };
    const out = filter.select(
      [
        post({ urn: '1', text: 'random cooking thoughts for the weekend' }),
        post({ urn: '2', text: 'shipping a new Vue component library today' }),
        post({ urn: '3', text: 'great giveaway! use code FREE' }),
      ],
      profile,
    );
    expect(out.likeable.map((p) => p.urn)).toEqual(['2', '1']); // Vue post first
    expect(out.skipped).toEqual([{ urn: '3', reason: 'promo' }]);
  });
});
