import { describe, it, expect } from 'vitest';
import { parseScore, clampPillar, normaliseRank, sumPillars } from './parse-helpers';

describe('parseScore', () => {
  it('parses plain integers', () => {
    expect(parseScore('23')).toBe(23);
  });

  it('parses locale decimals with comma', () => {
    expect(parseScore('23,4')).toBeCloseTo(23.4);
  });

  it('parses decimals with dot', () => {
    expect(parseScore('18.5 pts')).toBeCloseTo(18.5);
  });

  it('extracts the first number from noisy text', () => {
    expect(parseScore('Your score: 71 out of 100')).toBe(71);
  });

  it('handles non-breaking spaces', () => {
    expect(parseScore(' 71 ')).toBe(71);
  });

  it('returns null for missing or garbage input', () => {
    expect(parseScore(null)).toBeNull();
    expect(parseScore(undefined)).toBeNull();
    expect(parseScore('no digits here')).toBeNull();
    expect(parseScore('')).toBeNull();
  });
});

describe('clampPillar', () => {
  it('passes through values in range', () => {
    expect(clampPillar(0)).toBe(0);
    expect(clampPillar(12.5)).toBe(12.5);
    expect(clampPillar(25)).toBe(25);
  });

  it('clamps above 25 and below 0', () => {
    expect(clampPillar(30)).toBe(25);
    expect(clampPillar(-4)).toBe(0);
  });

  it('treats non-finite as 0', () => {
    expect(clampPillar(Number.NaN)).toBe(0);
    expect(clampPillar(Number.POSITIVE_INFINITY)).toBe(25);
  });
});

describe('normaliseRank', () => {
  it('canonicalises English form', () => {
    expect(normaliseRank('Top 4%')).toBe('Top 4%');
  });

  it('canonicalises Russian/spacing variants', () => {
    expect(normaliseRank('верхние 4 %')).toBe('Top 4%');
    expect(normaliseRank('1%')).toBe('Top 1%');
  });

  it('keeps decimal percentiles', () => {
    expect(normaliseRank('Top 0,5%')).toBe('Top 0.5%');
  });

  it('returns null without a percent', () => {
    expect(normaliseRank('top tier')).toBeNull();
    expect(normaliseRank(null)).toBeNull();
  });
});

describe('sumPillars', () => {
  it('sums four pillars into a 0..100 total', () => {
    expect(sumPillars([18, 20, 15, 18])).toBe(71);
  });

  it('clamps each pillar defensively before summing', () => {
    expect(sumPillars([30, 25, 25, 25])).toBe(100);
  });
});
