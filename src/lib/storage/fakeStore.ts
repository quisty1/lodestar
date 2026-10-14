import type { KeyValueStore } from '../ports';

/**
 * In-memory KeyValueStore that copies values the way chrome.storage does:
 * JSON round-trip on write and read, so callers cannot share object identity
 * with the stored record or hide a value Chrome would refuse to persist.
 */
export class FakeStore implements KeyValueStore {
  data = new Map<string, unknown>();

  get<T>(key: string): Promise<T | null> {
    if (!this.data.has(key)) return Promise.resolve(null);
    return Promise.resolve(copyStored<T>(this.data.get(key)));
  }

  set<T>(key: string, value: T): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.data.set(key, copyStored(value));
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Value is not JSON-serializable'));
      }
    });
  }
}

function copyStored<T>(value: unknown): T {
  const encoded = JSON.stringify(value, (_key, nested) => {
    if (typeof nested === 'function' || typeof nested === 'symbol' || typeof nested === 'bigint') {
      throw new TypeError('Value is not JSON-serializable');
    }
    return nested as unknown;
  });
  if (encoded === undefined) throw new TypeError('Value is not JSON-serializable');
  return JSON.parse(encoded) as T;
}
