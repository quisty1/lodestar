import { auditProfile } from './auditProfile';
import type { Observation, ProfileAuditResult, ProfileSnapshot } from './contracts';

const known = <T>(value: T): Observation<T> => ({ state: 'known', value });

export function profileSnapshotFixture(overrides: Partial<ProfileSnapshot> = {}): ProfileSnapshot {
  return {
    capturedAt: '2026-08-15T12:00:00.000Z',
    profileUrl: 'https://www.linkedin.com/in/example/',
    photo: known(true),
    banner: known(true),
    headline: known({ present: true, length: 60, terms: ['senior', 'frontend', 'developer'] }),
    about: known({ present: true, length: 500 }),
    location: known(true),
    industry: { state: 'unknown' },
    currentPosition: known({ present: true, titleTerms: ['frontend', 'lead'] }),
    educationCount: known(1),
    experience: known({ total: 3, past: 2, described: 3, quantified: 2 }),
    skills: known({ count: 15, terms: ['vue', 'typescript'] }),
    recommendations: known(true),
    featured: known(true),
    projects: known(true),
    publicUrl: known(true),
    openToWork: known({ enabled: true, titleTerms: ['frontend'] }),
    searchAppearances: known(10),
    ...overrides,
  };
}

export function profileAuditFixture(
  snapshotOverrides: Partial<ProfileSnapshot> = {},
  auditedAt = '2026-08-15T12:01:00.000Z',
): ProfileAuditResult {
  return auditProfile(profileSnapshotFixture(snapshotOverrides), auditedAt);
}
