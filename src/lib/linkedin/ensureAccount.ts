import type { Clock, KeyValueStore } from '../ports';
import { LinkedInAccountClient } from './LinkedInAccountClient';
import { ACCOUNT_KEY, isLinkedInAccount, type LinkedInAccount } from './account';
import { migrateLegacyAccount } from './migrateAccount';

export interface EnsureAccountDeps {
  store: KeyValueStore;
  client: LinkedInAccountClient;
  clock: Clock;
}

export async function ensureLinkedInAccount(
  deps: EnsureAccountDeps,
): Promise<LinkedInAccount | null> {
  const existing = await deps.store.get(ACCOUNT_KEY);
  let fetched: LinkedInAccount | null = null;
  try {
    fetched = await deps.client.fetchAccount(deps.clock.now().toISOString());
  } catch {
    fetched = null;
  }
  if (!fetched) return isLinkedInAccount(existing) ? existing : null;
  if (isLinkedInAccount(existing) && existing.id === fetched.id) return existing;
  if (!isLinkedInAccount(existing)) await migrateLegacyAccount(deps.store, fetched);
  await deps.store.set(ACCOUNT_KEY, fetched);
  return fetched;
}
