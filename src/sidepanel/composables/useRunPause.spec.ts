import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { RUN_PAUSE_KEY } from '@lib/autopilot/runPause';
import { useRunPause } from './useRunPause';

const mem = new Map<string, unknown>();

beforeEach(() => {
  mem.clear();
  vi.stubGlobal('chrome', {
    runtime: { id: 'x' },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: mem.get(key) })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const key of Object.keys(values)) mem.set(key, values[key]);
        }),
      },
    },
  });
});

describe('useRunPause', () => {
  it('loads a pause until tomorrow and clears it', async () => {
    mem.set(RUN_PAUSE_KEY, '2099-01-01');
    const api = mountPause();
    await flushPromises();
    expect(api.paused.value).toBe(true);

    await api.resume();
    expect(api.paused.value).toBe(false);
    expect(mem.get(RUN_PAUSE_KEY)).toBe('');

    await api.pauseTomorrow();
    expect(api.paused.value).toBe(true);
    expect(mem.get(RUN_PAUSE_KEY)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does not read storage when the panel bus is unavailable', async () => {
    vi.stubGlobal('chrome', {});
    const api = mountPause();
    await flushPromises();
    await api.reload();
    expect(api.paused.value).toBe(false);
  });
});

function mountPause() {
  let api!: ReturnType<typeof useRunPause>;
  mount(
    defineComponent({
      setup() {
        api = useRunPause();
        return () => null;
      },
    }),
  );
  return api;
}
