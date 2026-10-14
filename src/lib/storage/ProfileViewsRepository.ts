import type { ProfileViewsSnapshot } from '../types';
import type { KeyValueStore } from '../ports';
import { upsertDailySnapshot } from '../history/dailyHistory';

const LATEST_KEY = 'profileViews:latest';
const HISTORY_KEY = 'profileViews:history';

/**
 * Persists incoming profile-views (WVMP) snapshots. Mirror of SsiRepository, on
 * its OWN `profileViews:*` namespace — deliberately isolated from the outgoing
 * `views:*` action module (different semantics: day-bucketed cap-90 trend vs
 * newest-first cap-500 activity log).
 *
 * SRP: storage only. DIP: depends on the KeyValueStore port (fake in tests,
 * chrome.storage in prod). History is day-bucketed (one entry per calendar day,
 * latest capture wins) and capped to `historyDays`.
 */
export class ProfileViewsRepository {
  constructor(
    private readonly store: KeyValueStore,
    private readonly historyDays = 90,
  ) {}

  async save(snapshot: ProfileViewsSnapshot): Promise<void> {
    await this.store.set(LATEST_KEY, snapshot);
    const existing = await this.store.get<ProfileViewsSnapshot[]>(HISTORY_KEY);
    await this.store.set(HISTORY_KEY, upsertDailySnapshot(existing, snapshot, this.historyDays));
  }

  async latest(): Promise<ProfileViewsSnapshot | null> {
    return this.store.get<ProfileViewsSnapshot>(LATEST_KEY);
  }

  async history(): Promise<ProfileViewsSnapshot[]> {
    return (await this.store.get<ProfileViewsSnapshot[]>(HISTORY_KEY)) ?? [];
  }
}
