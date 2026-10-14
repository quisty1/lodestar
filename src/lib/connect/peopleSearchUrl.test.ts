import { describe, it, expect } from 'vitest';
import { peopleSearchUrl } from './peopleSearchUrl';

describe('peopleSearchUrl', () => {
  it('builds the people-search URL with url-encoded keywords', () => {
    expect(peopleSearchUrl('frontend recruiter')).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=frontend%20recruiter',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(peopleSearchUrl('  recruiter  ')).toContain('keywords=recruiter');
  });

  it('appends an OR-ed geoUrn filter when regions are given', () => {
    expect(peopleSearchUrl('recruiter', ['103644278', '101174742'])).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=recruiter&geoUrn=%5B%22103644278%22%2C%22101174742%22%5D&origin=FACETED_SEARCH',
    );
  });

  it('omits geoUrn when no regions are given', () => {
    expect(peopleSearchUrl('recruiter')).not.toContain('geoUrn');
  });
});
