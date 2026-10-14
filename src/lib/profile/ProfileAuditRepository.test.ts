import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '@lib/ports';
import { auditProfile } from './auditProfile';
import { ProfileAuditRepository } from './ProfileAuditRepository';
import type { Observation, ProfileSnapshot } from './contracts';

const known = <T>(value: T): Observation<T> => ({ state: 'known', value });

const snapshot: ProfileSnapshot = {
  capturedAt: '2026-08-15T12:00:00.000Z',
  profileUrl: 'https://www.linkedin.com/in/example/',
  photo: known(true),
  banner: known(true),
  headline: known({ present: true, length: 50, terms: ['frontend'] }),
  about: known({ present: true, length: 400 }),
  location: known(true),
  industry: known(true),
  currentPosition: known({ present: true, titleTerms: ['frontend'] }),
  educationCount: known(1),
  experience: known({ total: 2, past: 1, described: 2, quantified: 1 }),
  skills: known({ count: 10, terms: ['vue'] }),
  recommendations: known(true),
  featured: known(true),
  projects: known(true),
  publicUrl: known(true),
  openToWork: known({ enabled: true, titleTerms: ['frontend'] }),
  searchAppearances: known(4),
};

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
}

describe('ProfileAuditRepository', () => {
  it('persists and reloads only the validated audit result', async () => {
    const store = new MemoryStore();
    const repo = new ProfileAuditRepository(store);
    const result = auditProfile(snapshot, '2026-08-15T12:01:00.000Z');

    await repo.save(result);

    expect(await repo.latest()).toEqual(result);
    expect([...store.data.keys()]).toEqual(['profileAudit:lastResult']);
    expect(JSON.stringify(store.data.get('profileAudit:lastResult'))).not.toContain(
      'profile paragraph',
    );
  });

  it('fails closed for malformed or future stored data', async () => {
    const store = new MemoryStore();
    const repo = new ProfileAuditRepository(store);

    store.data.set('profileAudit:lastResult', { schemaVersion: 2, items: [] });
    expect(await repo.latest()).toBeNull();

    store.data.set('profileAudit:lastResult', { schemaVersion: 1, items: 'broken' });
    expect(await repo.latest()).toBeNull();

    store.data.set('profileAudit:lastResult', {
      ...auditProfile(snapshot, snapshot.capturedAt),
      auditedAt: 'not-a-date',
    });
    expect(await repo.latest()).toBeNull();

    const result = auditProfile(snapshot, snapshot.capturedAt);
    store.data.set('profileAudit:lastResult', {
      ...result,
      categories: result.categories.slice(1),
    });
    expect(await repo.latest()).toBeNull();

    store.data.set('profileAudit:lastResult', {
      ...result,
      categories: result.categories.map((category, index) =>
        index === 0 ? { ...category, known: category.total + 1 } : category,
      ),
    });
    expect(await repo.latest()).toBeNull();
  });
});
