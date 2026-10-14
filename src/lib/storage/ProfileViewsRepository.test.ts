import { describe, it, expect, beforeEach } from 'vitest';
import { ProfileViewsRepository } from './ProfileViewsRepository';
import type { ProfileViewsSnapshot } from '../types';
import { FakeStore } from './fakeStore';

function snap(count: number, at: string): ProfileViewsSnapshot {
  return { count, windowDays: 90, capturedAt: at };
}

describe('ProfileViewsRepository', () => {
  let store: FakeStore;
  let repo: ProfileViewsRepository;

  beforeEach(() => {
    store = new FakeStore();
    repo = new ProfileViewsRepository(store, 3);
  });

  it('returns null latest / empty history when empty', async () => {
    expect(await repo.latest()).toBeNull();
    expect(await repo.history()).toEqual([]);
  });

  it('saves and reads back the latest snapshot', async () => {
    const s = snap(45, '2026-07-02T10:00:00.000Z');
    await repo.save(s);
    expect(await repo.latest()).toEqual(s);
    expect(await repo.history()).toHaveLength(1);
  });

  it('caps history at the configured limit, keeping newest', async () => {
    await repo.save(snap(1, 'a'));
    await repo.save(snap(2, 'b'));
    await repo.save(snap(3, 'c'));
    await repo.save(snap(4, 'd'));
    const history = await repo.history();
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.count)).toEqual([2, 3, 4]);
  });

  it('keeps one history entry per day — a second same-day save overwrites it', async () => {
    await repo.save(snap(40, '2026-07-02T08:00:00.000Z'));
    await repo.save(snap(45, '2026-07-02T21:00:00.000Z')); // same day, later refresh
    const history = await repo.history();
    expect(history).toHaveLength(1);
    expect(history[0].count).toBe(45);
    expect((await repo.latest())?.count).toBe(45);
  });

  it('uses its OWN namespace, isolated from the outgoing views module', async () => {
    await repo.save(snap(45, '2026-07-02T10:00:00.000Z'));
    expect(store.data.has('profileViews:latest')).toBe(true);
    expect(store.data.has('profileViews:history')).toBe(true);
    // must NOT collide with the outgoing views action module (views:*)
    expect([...store.data.keys()].some((k) => k.startsWith('views:'))).toBe(false);
  });
});
