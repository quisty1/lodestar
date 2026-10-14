import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { useEngagementStats } from './useEngagementStats';

const mem = new Map<string, unknown>();
const changed: Array<() => void> = [];

beforeEach(() => {
  mem.clear();
  changed.length = 0;
  vi.stubGlobal('chrome', {
    runtime: { id: 'x' },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: mem.get(key) })),
        set: vi.fn(async () => {}),
      },
      onChanged: {
        addListener: (fn: () => void) => changed.push(fn),
        removeListener: vi.fn(),
      },
    },
  });
});

describe('useEngagementStats', () => {
  it('zeros counts from another day and keeps the ceiling', async () => {
    mem.set('autopilot:state', { day: '2000-01-01', used: 9, ceiling: 35 });
    mem.set('comments:budget', { day: '2000-01-01', used: 4 });
    const api = mountStats();
    await flushPromises();
    expect(api.likes.value).toBe(0);
    expect(api.comments.value).toBe(0);
    expect(api.ceiling.value).toBe(35);
  });

  it('treats a storage rejection as empty counters', async () => {
    chrome.storage.local.get = vi.fn(async () => Promise.reject(new Error('disk')));
    const api = mountStats();
    await flushPromises();
    expect(api.likes.value).toBe(0);
    expect(api.comments.value).toBe(0);
    expect(api.ceiling.value).toBe(0);
  });

  it('refreshes when storage changes', async () => {
    const api = mountStats();
    await flushPromises();
    const today = new Date().toISOString().slice(0, 10);
    mem.set('autopilot:state', { day: today, used: 2, ceiling: 20 });
    mem.set('comments:budget', { day: today, used: 1 });
    changed[0]?.();
    await flushPromises();
    expect(api.likes.value).toBe(2);
    expect(api.comments.value).toBe(1);
    expect(api.ceiling.value).toBe(20);
  });
});

function mountStats() {
  let api!: ReturnType<typeof useEngagementStats>;
  mount(
    defineComponent({
      setup() {
        api = useEngagementStats();
        return () => null;
      },
    }),
  );
  return api;
}
