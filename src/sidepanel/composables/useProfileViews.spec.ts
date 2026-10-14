import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { LodestarMessage, ProfileViewsSnapshot } from '@lib/types';
import { useProfileViews } from './useProfileViews';

const mem = new Map<string, unknown>();
const listeners: Array<(message: LodestarMessage) => void> = [];

beforeEach(() => {
  mem.clear();
  listeners.length = 0;
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'x',
      sendMessage: vi.fn(async () => undefined),
      onMessage: {
        addListener: (fn: (message: LodestarMessage) => void) => listeners.push(fn),
        removeListener: vi.fn(),
      },
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: mem.get(key) })),
        set: vi.fn(async () => {}),
      },
    },
  });
});

function snap(count: number, capturedAt: string): ProfileViewsSnapshot {
  return { count, windowDays: 90, capturedAt };
}

describe('useProfileViews', () => {
  it('keeps persisted history and applies a live snapshot', async () => {
    const stored = snap(4, '2026-10-07T00:00:00.000Z');
    mem.set('profileViews:history', [stored]);
    mem.set('profileViews:latest', stored);
    const api = mountViews();
    await flushPromises();
    expect(api.isReal.value).toBe(true);
    expect(api.history.value).toEqual([stored]);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'REQUEST_REFRESH' });

    const live = snap(9, '2026-10-08T00:00:00.000Z');
    listeners[0]?.({ type: 'PROFILE_VIEWS_SNAPSHOT', payload: live });
    expect(api.latest.value).toEqual(live);
    expect(api.history.value.map((item) => item.count)).toEqual([4, 9]);
    expect(api.isReal.value).toBe(true);
  });

  it('stays empty outside the extension', async () => {
    vi.stubGlobal('chrome', {});
    const api = mountViews();
    await flushPromises();
    expect(api.history.value).toEqual([]);
    expect(api.isReal.value).toBe(false);
  });
});

function mountViews() {
  let api!: ReturnType<typeof useProfileViews>;
  mount(
    defineComponent({
      setup() {
        api = useProfileViews();
        return () => null;
      },
    }),
  );
  return api;
}
