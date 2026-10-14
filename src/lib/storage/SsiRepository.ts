import type { SsiSnapshot } from '../types';
import type { KeyValueStore } from '../ports';
import { upsertDailySnapshot } from '../ssi/ssiHistory';

const LATEST_KEY = 'ssi:latest';
const HISTORY_KEY = 'ssi:history';

/**
 * Persists SSI snapshots. SRP: only storage concerns — knows nothing about DOM
 * or parsing. DIP: depends on the KeyValueStore port, so it's testable with a
 * fake and swappable to chrome.storage in production.
 *
 * History is day-bucketed (one entry per calendar day, latest capture wins) and
 * capped to `historyDays`, so several refreshes in a day don't crowd out the
 * long-run trend the dashboard shows.
 */
export class SsiRepository {
  constructor(
    private readonly store: KeyValueStore,
    private readonly historyDays = 90,
  ) {}

  async save(snapshot: SsiSnapshot): Promise<void> {
    await this.store.set(LATEST_KEY, snapshot);
    const existing = await this.store.get<SsiSnapshot[]>(HISTORY_KEY);
    await this.store.set(HISTORY_KEY, upsertDailySnapshot(existing, snapshot, this.historyDays));
  }

  async latest(): Promise<SsiSnapshot | null> {
    return this.store.get<SsiSnapshot>(LATEST_KEY);
  }

  async history(): Promise<SsiSnapshot[]> {
    return (await this.store.get<SsiSnapshot[]>(HISTORY_KEY)) ?? [];
  }
}
