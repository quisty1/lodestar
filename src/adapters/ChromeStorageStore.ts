import type { KeyValueStore } from '@lib/ports';
import { ACCOUNT_KEY, ACCOUNT_SCOPED_KEYS, accountStorageKey } from '@lib/linkedin/account';

/**
 * chrome.storage.local implementation of KeyValueStore. Thin edge adapter:
 * the only place core storage logic touches the chrome.* API (DIP boundary).
 * Account-owned keys are stored under `acct:${id}:` once `linkedin:account` exists.
 */
export class ChromeStorageStore implements KeyValueStore {
  async get<T>(key: string): Promise<T | null> {
    const physical = await physicalKey(key);
    const result = await chrome.storage.local.get(physical);
    return (result[physical] as T) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const physical = await physicalKey(key);
    await chrome.storage.local.set({ [physical]: value });
  }
}

async function physicalKey(key: string): Promise<string> {
  if (!ACCOUNT_SCOPED_KEYS.has(key)) return key;
  const stored = await chrome.storage.local.get(ACCOUNT_KEY);
  const account = stored[ACCOUNT_KEY] as { id?: unknown } | undefined;
  const id = account && typeof account.id === 'string' && account.id.length > 0 ? account.id : null;
  return id ? accountStorageKey(id, key) : key;
}
