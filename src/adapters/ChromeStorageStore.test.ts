import { beforeEach, describe, expect, it } from 'vitest';
import { ChromeStorageStore } from './ChromeStorageStore';

const mem = new Map<string, unknown>();

beforeEach(() => {
  mem.clear();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: mem.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) mem.set(key, value);
        },
      },
    },
  };
});

describe('ChromeStorageStore account scope', () => {
  it('keeps legacy keys until an account is known', async () => {
    const store = new ChromeStorageStore();
    await store.set('content:drafts', [{ id: 'd1' }]);
    await store.set('llm:config', { key: 'k' });
    expect(mem.has('content:drafts')).toBe(true);
    expect(await store.get('llm:config')).toEqual({ key: 'k' });
  });

  it('prefixes drafts and history for the signed-in account', async () => {
    mem.set('linkedin:account', {
      id: 'ada',
      publicId: 'ada',
      capturedAt: '2026-10-08T00:00:00.000Z',
    });
    const store = new ChromeStorageStore();
    await store.set('content:drafts', [{ id: 'd1' }]);
    await store.set('llm:config', { key: 'k' });
    expect(mem.has('acct:ada:content:drafts')).toBe(true);
    expect(mem.has('content:drafts')).toBe(false);
    expect(mem.get('llm:config')).toEqual({ key: 'k' });
    expect(await store.get('content:drafts')).toEqual([{ id: 'd1' }]);
  });
});
