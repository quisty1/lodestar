import { describe, it, expect } from 'vitest';
import { SnapshotRefreshService, type SnapshotSource } from './BackgroundRefreshService';
import { RefreshPolicy } from './RefreshPolicy';
import type { Clock } from '../ports';
import type { ProfileViewsSnapshot } from '../types';
import { FakeStore } from '../storage/fakeStore';

const clockAt = (iso: string): Clock => ({ now: () => new Date(iso) });
const source = (
  raw: Omit<ProfileViewsSnapshot, 'capturedAt'>,
): SnapshotSource<ProfileViewsSnapshot> => ({
  fetchSnapshot: async () => raw,
});

// The generic refresher must work for any metric with its OWN refresh key, so a
// second metric (profile-views) never collides with SSI's cadence bookkeeping.
describe('SnapshotRefreshService (generic, per-metric key)', () => {
  it('stamps capturedAt and records the timestamp under its OWN key', async () => {
    const store = new FakeStore();
    const svc = new SnapshotRefreshService<ProfileViewsSnapshot>({
      policy: new RefreshPolicy(86_400_000),
      apiClient: source({ count: 45, windowDays: 90 }),
      store,
      clock: clockAt('2026-07-02T10:00:00.000Z'),
      lastRefreshKey: 'profileViews:lastRefreshAt',
    });

    const res = await svc.refreshNow();
    expect(res).toEqual({
      status: 'refreshed',
      snapshot: { count: 45, windowDays: 90, capturedAt: '2026-07-02T10:00:00.000Z' },
    });
    expect(store.data.get('profileViews:lastRefreshAt')).toBe('2026-07-02T10:00:00.000Z');
    expect(store.data.has('ssi:lastRefreshAt')).toBe(false); // isolated from SSI
  });

  it('skips when the policy says it is not yet due (reads its own key)', async () => {
    const store = new FakeStore();
    store.data.set('profileViews:lastRefreshAt', '2026-07-02T09:59:00.000Z');
    const svc = new SnapshotRefreshService<ProfileViewsSnapshot>({
      policy: new RefreshPolicy(86_400_000),
      apiClient: source({ count: 45, windowDays: 90 }),
      store,
      clock: clockAt('2026-07-02T10:00:00.000Z'),
      lastRefreshKey: 'profileViews:lastRefreshAt',
    });
    expect(await svc.refreshIfDue()).toEqual({ status: 'skipped' });
  });

  it('reports an error (never a fake snapshot) when the source throws', async () => {
    const svc = new SnapshotRefreshService<ProfileViewsSnapshot>({
      policy: new RefreshPolicy(0),
      apiClient: {
        fetchSnapshot: async () => {
          throw new Error('WVMP 403');
        },
      },
      store: new FakeStore(),
      clock: clockAt('2026-07-02T10:00:00.000Z'),
      lastRefreshKey: 'profileViews:lastRefreshAt',
    });
    expect(await svc.refreshNow()).toEqual({ status: 'error', error: 'WVMP 403' });
  });
});
