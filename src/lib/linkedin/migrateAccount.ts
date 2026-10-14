import type { KeyValueStore } from '../ports';
import type { Draft } from '../types';
import { asArray } from '../engagement/settings';
import {
  ACCOUNT_SCOPED_KEYS,
  MIGRATED_ACCOUNT_KEY,
  accountStorageKey,
  type LinkedInAccount,
} from './account';

export async function migrateLegacyAccount(
  store: KeyValueStore,
  account: LinkedInAccount,
): Promise<void> {
  const marker = await store.get<string>(MIGRATED_ACCOUNT_KEY);
  if (typeof marker === 'string') return;
  for (const key of ACCOUNT_SCOPED_KEYS) {
    const legacy = await store.get(key);
    if (legacy == null) continue;
    const value = key === 'content:drafts' ? stampDrafts(legacy, account.id) : legacy;
    await store.set(accountStorageKey(account.id, key), value);
  }
  await store.set(MIGRATED_ACCOUNT_KEY, account.id);
}

function stampDrafts(value: unknown, accountId: string): Draft[] {
  return asArray<Draft>(value).map((draft) => (draft.accountId ? draft : { ...draft, accountId }));
}
