import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the panel bus so useContent imports cleanly in jsdom (no chrome.runtime).
const request = vi.fn();
vi.mock('../lib/panelBus', () => ({
  panelBus: { request: (...a: unknown[]) => request(...a), available: () => true },
}));

// Minimal in-memory chrome.storage.local so ChromeStorageStore works in jsdom.
const mem = new Map<string, unknown>();
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (k: string) => ({ [k]: mem.get(k) }),
      set: async (o: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(o)) mem.set(k, v);
      },
    },
  },
};

import { useContent } from './useContent';

beforeEach(() => {
  request.mockReset();
  mem.clear();
});

describe('useContent post budget', () => {
  it('loadPostBudget computes remaining against the default weekly cap (3)', async () => {
    const c = useContent();
    await c.loadPostBudget();
    expect(c.postsLeft.value).toBe(3);
  });
});
