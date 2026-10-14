import { describe, expect, it } from 'vitest';
import { filterExcluded, geoUrnsForConnect, isExcluded, resolveExcludeKeywords } from './exclusion';

describe('exclusion filter', () => {
  it('bundles India places and staffing tells, plus custom words', () => {
    const words = resolveExcludeKeywords({
      excludeIndia: true,
      excludeKeywords: ['Staffing Agency', ''],
    });
    expect(words).toContain('hyderabad');
    expect(words).toContain('bench sales');
    expect(words).toContain('staffing agency');
  });

  it('matches headline and location, never a personal name alone', () => {
    const words = resolveExcludeKeywords({
      excludeIndia: true,
      excludeKeywords: [],
    });
    expect(isExcluded({ headline: 'US IT Recruiter | C2C', location: '' }, words)).toBe(true);
    expect(
      isExcluded({ headline: 'Technical Recruiter', location: 'Bengaluru, India' }, words),
    ).toBe(true);
    expect(isExcluded({ headline: 'Talent Lead', location: 'Austin, Texas' }, words)).toBe(false);
    expect(isExcluded({ headline: 'David De Graeve', location: '' }, words)).toBe(false);
  });

  it('drops excluded candidates and leaves the rest', () => {
    const words = resolveExcludeKeywords({
      excludeIndia: false,
      excludeKeywords: ['bench sales'],
    });
    const kept = filterExcluded(
      [
        { headline: 'Bench Sales Recruiter', location: '' },
        { headline: 'Frontend recruiter', location: 'Berlin' },
      ],
      words,
    );
    expect(kept.map((c) => c.headline)).toEqual(['Frontend recruiter']);
  });

  it('removes the India geoUrn from search when the preset is on', () => {
    expect(geoUrnsForConnect(['IN', 'SG'], true)).not.toContain('102713980');
    expect(geoUrnsForConnect(['IN', 'SG'], true)).toContain('102454443');
    expect(geoUrnsForConnect(['IN', 'SG'], false)).toContain('102713980');
  });
});
