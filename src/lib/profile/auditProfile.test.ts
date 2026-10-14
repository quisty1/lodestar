import { describe, expect, it } from 'vitest';
import { auditProfile } from './auditProfile';
import type { Observation, ProfileSnapshot } from './contracts';

const known = <T>(value: T): Observation<T> => ({ state: 'known', value });
const unknown = <T>(): Observation<T> => ({ state: 'unknown' });

const complete: ProfileSnapshot = {
  capturedAt: '2026-08-15T12:00:00.000Z',
  profileUrl: 'https://www.linkedin.com/in/example/',
  photo: known(true),
  banner: known(true),
  headline: known({ present: true, length: 72, terms: ['senior', 'frontend', 'developer', 'vue'] }),
  about: known({ present: true, length: 620 }),
  location: known(true),
  industry: known(true),
  currentPosition: known({ present: true, titleTerms: ['technical', 'lead', 'frontend'] }),
  educationCount: known(1),
  experience: known({ total: 3, past: 2, described: 3, quantified: 2 }),
  skills: known({ count: 22, terms: ['vue', 'typescript', 'javascript'] }),
  recommendations: known(true),
  featured: known(true),
  projects: known(true),
  publicUrl: known(true),
  openToWork: known({ enabled: true, titleTerms: ['senior', 'frontend', 'developer'] }),
  searchAppearances: known(10),
};

describe('auditProfile', () => {
  it('returns category outcomes without an invented global score', () => {
    const result = auditProfile(complete, '2026-08-15T12:01:00.000Z');

    expect(result.schemaVersion).toBe(1);
    expect(result).not.toHaveProperty('completeness');
    expect(result.items.every((item) => item.status === 'pass')).toBe(true);
    expect(result.categories.map((category) => category.key)).toEqual([
      'completeness',
      'discoverability',
      'consistency',
      'evidence',
    ]);
    expect(result.metrics.searchAppearances).toBe(10);
  });

  it('prioritizes missing recruiter essentials and keeps advisory gaps as warnings', () => {
    const result = auditProfile(
      {
        ...complete,
        photo: known(false),
        headline: known({ present: false, length: 0, terms: [] }),
        openToWork: known({ enabled: false, titleTerms: [] }),
        featured: known(false),
      },
      complete.capturedAt,
    );

    expect(result.items.find((item) => item.key === 'photo')).toMatchObject({
      status: 'fail',
      severity: 'high',
    });
    expect(result.items.find((item) => item.key === 'headline')).toMatchObject({
      status: 'fail',
      severity: 'high',
    });
    expect(result.items.find((item) => item.key === 'openToWork')).toMatchObject({
      status: 'warn',
      severity: 'high',
    });
    expect(result.items.find((item) => item.key === 'featured')).toMatchObject({
      status: 'warn',
      severity: 'medium',
    });
  });

  it('uses deterministic thresholds for headline, About and skills', () => {
    const result = auditProfile(
      {
        ...complete,
        headline: known({ present: true, length: 24, terms: ['frontend'] }),
        about: known({ present: true, length: 180 }),
        skills: known({ count: 7, terms: ['vue', 'typescript'] }),
      },
      complete.capturedAt,
    );

    expect(result.items.find((item) => item.key === 'headline')?.status).toBe('warn');
    expect(result.items.find((item) => item.key === 'about')?.status).toBe('warn');
    expect(result.items.find((item) => item.key === 'skills')?.status).toBe('warn');
  });

  it('checks title alignment only when every required observation is known', () => {
    const misaligned = auditProfile(
      {
        ...complete,
        headline: known({ present: true, length: 50, terms: ['product', 'designer'] }),
        currentPosition: known({ present: true, titleTerms: ['backend', 'engineer'] }),
        openToWork: known({ enabled: true, titleTerms: ['data', 'analyst'] }),
      },
      complete.capturedAt,
    );
    const unknownTarget = auditProfile({ ...complete, openToWork: unknown() }, complete.capturedAt);

    expect(misaligned.items.find((item) => item.key === 'roleAlignment')?.status).toBe('warn');
    expect(unknownTarget.items.find((item) => item.key === 'roleAlignment')?.status).toBe(
      'unknown',
    );
  });

  it('audits Experience description coverage and quantified outcomes', () => {
    const result = auditProfile(
      {
        ...complete,
        experience: known({ total: 4, past: 3, described: 2, quantified: 0 }),
      },
      complete.capturedAt,
    );

    expect(result.items.find((item) => item.key === 'experienceDescriptions')).toMatchObject({
      status: 'warn',
    });
    expect(result.items.find((item) => item.key === 'quantifiedOutcomes')).toMatchObject({
      status: 'warn',
    });
  });

  it('excludes unknown rules from category progress instead of treating them as failures', () => {
    const result = auditProfile(
      {
        ...complete,
        industry: unknown(),
        recommendations: unknown(),
        openToWork: unknown(),
        searchAppearances: unknown(),
      },
      complete.capturedAt,
    );
    const completeness = result.categories.find((category) => category.key === 'completeness')!;

    expect(result.items.find((item) => item.key === 'industry')?.status).toBe('unknown');
    expect(result.metrics.searchAppearances).toBeUndefined();
    expect(completeness.unknown).toBe(1);
    expect(completeness.known).toBe(completeness.total - 1);
    expect(completeness.progress).toBe(100);
  });

  it('never persists raw profile copy in rule evidence', () => {
    const rawNeedle = 'confidential profile paragraph';
    const result = auditProfile(
      {
        ...complete,
        about: known({ present: true, length: rawNeedle.length }),
      },
      complete.capturedAt,
    );

    expect(JSON.stringify(result)).not.toContain(rawNeedle);
    expect(result.items.every((item) => item.editUrl.startsWith('https://www.linkedin.com/'))).toBe(
      true,
    );
  });
});
