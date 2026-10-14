import type { Clock, KeyValueStore } from '../ports';
import type { SsiApiClient } from '../ssi-api/contracts';
import type { SsiSnapshot } from '../types';
import { RefreshPolicy } from './RefreshPolicy';

export const LAST_REFRESH_KEY = 'ssi:lastRefreshAt';

export type RefreshResult<T = SsiSnapshot> =
  | { status: 'skipped' }
  | { status: 'refreshed'; snapshot: T }
  | { status: 'error'; error: string }
  | { status: 'busy' };

/** Fetches a raw snapshot (pre-timestamp) for one metric. Generic over payload. */
export interface SnapshotSource<T extends { capturedAt: string }> {
  fetchSnapshot(): Promise<Omit<T, 'capturedAt'>>;
}

export interface SnapshotRefreshDeps<T extends { capturedAt: string }> {
  policy: RefreshPolicy;
  apiClient: SnapshotSource<T>;
  store: KeyValueStore;
  clock: Clock;
  /** Storage key holding the ISO time of the last successful refresh (per metric). */
  lastRefreshKey: string;
}

/**
 * Generic background refresh for ONE metric: policy gating + single-flight +
 * timestamp bookkeeping. Runs entirely in the service worker — no tab, no window,
 * no visible flash.
 *
 * SRP: it does NOT fetch (the source does), does NOT interpret the payload (the
 * source's parser does), and does NOT persist the snapshot (the SW saves it via a
 * repository). Each metric gets its OWN instance with its OWN `lastRefreshKey`, so
 * one metric's failure or cadence never touches another.
 */
export class SnapshotRefreshService<T extends { capturedAt: string }> {
  private inFlight = false;

  constructor(private readonly deps: SnapshotRefreshDeps<T>) {}

  /** Refresh only if the policy says enough time has passed. */
  async refreshIfDue(): Promise<RefreshResult<T>> {
    const last = await this.deps.store.get<string>(this.deps.lastRefreshKey);
    if (!this.deps.policy.isDue(last, this.deps.clock.now())) {
      return { status: 'skipped' };
    }
    return this.refreshNow();
  }

  /** Force a refresh regardless of timing (e.g. the panel's refresh button). */
  async refreshNow(): Promise<RefreshResult<T>> {
    if (this.inFlight) return { status: 'busy' };
    this.inFlight = true;

    const { apiClient, store, clock, lastRefreshKey } = this.deps;
    try {
      const raw = await apiClient.fetchSnapshot();
      const capturedAt = clock.now().toISOString();
      const snapshot = { ...raw, capturedAt } as T;
      await store.set(lastRefreshKey, capturedAt);
      return { status: 'refreshed', snapshot };
    } catch (e) {
      return { status: 'error', error: e instanceof Error ? e.message : String(e) };
    } finally {
      this.inFlight = false;
    }
  }
}

export interface BackgroundRefreshDeps {
  policy: RefreshPolicy;
  apiClient: SsiApiClient;
  store: KeyValueStore;
  clock: Clock;
}

/**
 * SSI refresh — a thin, back-compatible alias over the generic service bound to
 * the SSI refresh key. Existing callers construct it unchanged.
 */
export class BackgroundRefreshService extends SnapshotRefreshService<SsiSnapshot> {
  constructor(deps: BackgroundRefreshDeps) {
    super({ ...deps, lastRefreshKey: LAST_REFRESH_KEY });
  }
}
