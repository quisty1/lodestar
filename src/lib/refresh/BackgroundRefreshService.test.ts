import { describe, it, expect, beforeEach } from 'vitest';
import { BackgroundRefreshService, LAST_REFRESH_KEY } from './BackgroundRefreshService';
import { RefreshPolicy } from './RefreshPolicy';
import type { Clock } from '../ports';
import type { SsiApiClient, RawSnapshot } from '../ssi-api/contracts';
import { SsiApiError } from '../ssi-api/contracts';
import { FakeStore } from '../storage/fakeStore';

class FakeApiClient implements SsiApiClient {
  calls = 0;
  constructor(private readonly impl: () => RawSnapshot) {}
  async fetchSnapshot(): Promise<RawSnapshot> {
    this.calls += 1;
    return this.impl();
  }
}

const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });
const raw = (total: number): RawSnapshot => ({ total, pillars: [] });

const NOW = '2026-06-23T12:00:00.000Z';

describe('BackgroundRefreshService', () => {
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
  });

  const build = (api: SsiApiClient) =>
    new BackgroundRefreshService({
      policy: new RefreshPolicy(24 * 60 * 60 * 1000),
      apiClient: api,
      store,
      clock: fixedClock(NOW),
    });

  it('skips (no API call) when a refresh is not due', async () => {
    await store.set(LAST_REFRESH_KEY, NOW); // just refreshed
    const api = new FakeApiClient(() => raw(50));
    const result = await build(api).refreshIfDue();
    expect(result.status).toBe('skipped');
    expect(api.calls).toBe(0);
  });

  it('fetches when due, stamps capturedAt, and records the timestamp', async () => {
    const api = new FakeApiClient(() => raw(73));
    const result = await build(api).refreshNow();

    expect(result).toMatchObject({
      status: 'refreshed',
      snapshot: { total: 73, capturedAt: NOW },
    });
    expect(await store.get<string>(LAST_REFRESH_KEY)).toBe(NOW);
  });

  it('returns an error (without recording success) when the API fails', async () => {
    const api = new FakeApiClient(() => {
      throw new SsiApiError('403');
    });
    const result = await build(api).refreshNow();
    expect(result.status).toBe('error');
    expect(await store.get<string>(LAST_REFRESH_KEY)).toBeNull();
  });

  it('is single-flight: a concurrent refresh returns busy', async () => {
    let release!: (s: RawSnapshot) => void;
    const gate = new Promise<RawSnapshot>((r) => (release = r));
    const api: SsiApiClient = { fetchSnapshot: () => gate };
    const svc = build(api);

    const first = svc.refreshNow();
    const second = await svc.refreshNow();
    expect(second.status).toBe('busy');

    release(raw(50));
    expect((await first).status).toBe('refreshed');
  });
});
