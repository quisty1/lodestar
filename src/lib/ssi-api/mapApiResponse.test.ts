import { describe, it, expect } from 'vitest';
import { mapApiResponse } from './mapApiResponse';
import { SsiApiError, type SsiApiResponse } from './contracts';

// Verbatim shape captured from a live /sales-api/salesApiSsi response
// (non-Sales-Navigator member, 2026-06). The DOM for the same account showed
// total 20, brand 13.118, people 3.68, insights 0.3, relationships 2.608,
// industry "Top 75%", network "Top 81%".
const LIVE: SsiApiResponse = {
  activeSeat: false,
  memberScore: {
    overall: 19.705751,
    subScores: [
      { score: 13.118002, pillar: 'PROFESSIONAL_BRAND' },
      { score: 3.68, pillar: 'FIND_RIGHT_PEOPLE' },
      { score: 0.29999998, pillar: 'INSIGHT_ENGAGEMENT' },
      { score: 2.6077502, pillar: 'STRONG_RELATIONSHIP' },
    ],
  },
  groupScore: [
    { groupType: 'INDUSTRY', rank: 75, score: { overall: 30.99, subScores: [] } },
    { groupType: 'NETWORK', rank: 81, score: { overall: 32.72, subScores: [] } },
  ],
};

describe('mapApiResponse', () => {
  it('maps the member total (rounded to match the LinkedIn gauge)', () => {
    expect(mapApiResponse(LIVE).total).toBe(20);
  });

  it('maps all four pillars to canonical keys, in canonical order', () => {
    const { pillars } = mapApiResponse(LIVE);
    expect(pillars.map((p) => p.key)).toEqual(['brand', 'people', 'insights', 'relationships']);
  });

  it('preserves precise pillar scores and attaches localized labels', () => {
    const byKey = Object.fromEntries(mapApiResponse(LIVE).pillars.map((p) => [p.key, p]));
    expect(byKey.brand.score).toBeCloseTo(13.118002, 5);
    expect(byKey.people.score).toBeCloseTo(3.68, 5);
    expect(byKey.insights.score).toBeCloseTo(0.29999998, 5);
    expect(byKey.relationships.score).toBeCloseTo(2.6077502, 5);
    expect(byKey.brand.label).toBeTruthy();
  });

  it('maps industry and network ranks to "Top N%" strings', () => {
    const snap = mapApiResponse(LIVE);
    expect(snap.industryRank).toBe('Top 75%');
    expect(snap.networkRank).toBe('Top 81%');
  });

  it('omits ranks when groupScore is absent', () => {
    const snap = mapApiResponse({ memberScore: LIVE.memberScore });
    expect(snap.industryRank).toBeUndefined();
    expect(snap.networkRank).toBeUndefined();
  });

  it('is order-independent for subScores', () => {
    const shuffled: SsiApiResponse = {
      memberScore: {
        overall: 19.7,
        subScores: [
          { score: 2.6077502, pillar: 'STRONG_RELATIONSHIP' },
          { score: 13.118002, pillar: 'PROFESSIONAL_BRAND' },
          { score: 0.3, pillar: 'INSIGHT_ENGAGEMENT' },
          { score: 3.68, pillar: 'FIND_RIGHT_PEOPLE' },
        ],
      },
    };
    expect(mapApiResponse(shuffled).pillars.map((p) => p.key)).toEqual([
      'brand',
      'people',
      'insights',
      'relationships',
    ]);
  });

  it('throws SsiApiError when memberScore is missing', () => {
    expect(() => mapApiResponse({} as SsiApiResponse)).toThrow(SsiApiError);
  });

  it('throws SsiApiError when a pillar is absent from the payload', () => {
    const incomplete: SsiApiResponse = {
      memberScore: {
        overall: 10,
        subScores: [{ score: 5, pillar: 'PROFESSIONAL_BRAND' }],
      },
    };
    expect(() => mapApiResponse(incomplete)).toThrow(SsiApiError);
  });
});
