import { defineComponent, h, type Ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleState } from '@lib/types';
import {
  MODULE_STATE_SCHEMA_VERSION,
  MODULE_STATE_VERSION_KEY,
  MODULES_STATE_KEY,
  defaultModules,
} from '@lib/modules/moduleState';
import { useModules } from './useModules';

interface ModulesApi {
  modules: Ref<ModuleState[]>;
  toggle(id: ModuleId): Promise<void>;
  setLimit(id: ModuleId, value: number): Promise<void>;
}

const mem = new Map<string, unknown>();
let storageSet: ReturnType<typeof vi.fn>;

function mountComposable(): { api: ModulesApi; unmount(): void } {
  let api: ModulesApi | undefined;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useModules();
        return () => h('div');
      },
    }),
  );
  return {
    api: api!,
    unmount: () => {
      wrapper.unmount();
    },
  };
}

beforeEach(() => {
  mem.clear();
  storageSet = vi.fn(async (values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) mem.set(key, value);
  });
  (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
    runtime: { id: 'test-extension' },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: mem.get(key) })),
        set: storageSet,
      },
    },
  } as unknown as typeof chrome;
});

describe('useModules', () => {
  it('mounts with and persists the same fresh defaults the worker will read', async () => {
    const { api, unmount } = mountComposable();
    await flushPromises();

    expect(api.modules.value).toEqual(defaultModules());
    expect(mem.get(MODULES_STATE_KEY)).toEqual(defaultModules());
    expect(mem.get(MODULE_STATE_VERSION_KEY)).toBe(MODULE_STATE_SCHEMA_VERSION);
    unmount();
  });

  it('preserves an intentional all-disabled roster on mount', async () => {
    const saved = defaultModules().map((module) => ({ ...module, enabled: false }));
    mem.set(MODULES_STATE_KEY, saved);
    mem.set(MODULE_STATE_VERSION_KEY, MODULE_STATE_SCHEMA_VERSION);

    const { api, unmount } = mountComposable();
    await flushPromises();

    expect(api.modules.value).toEqual(saved);
    unmount();
  });

  it('recovers an old numeric-key shape and pins stale availability', async () => {
    mem.set(MODULES_STATE_KEY, {
      0: {
        id: 'smart_connect',
        enabled: true,
        automationLevel: 'manual',
        available: false,
        dailyLimit: 80,
      },
    });

    const { api, unmount } = mountComposable();
    await flushPromises();

    expect(api.modules.value.find((module) => module.id === 'smart_connect')).toMatchObject({
      enabled: true,
      available: true,
      dailyLimit: 80,
    });
    expect(Array.isArray(mem.get(MODULES_STATE_KEY))).toBe(true);
    unmount();
  });

  it('serializes awaitable writes so an older snapshot cannot overwrite the latest change', async () => {
    mem.set(MODULES_STATE_KEY, defaultModules());
    mem.set(MODULE_STATE_VERSION_KEY, MODULE_STATE_SCHEMA_VERSION);
    let stateWrite = 0;
    storageSet.mockImplementation(async (values: Record<string, unknown>) => {
      const snapshot = values[MODULES_STATE_KEY] as ModuleState[] | undefined;
      if (snapshot) {
        stateWrite += 1;
        if (stateWrite === 1) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      for (const [key, value] of Object.entries(values)) mem.set(key, value);
    });

    const { api, unmount } = mountComposable();
    await flushPromises();
    const toggled = api.toggle('engagement');
    const limited = api.setLimit('engagement', 50);
    await Promise.all([toggled, limited]);

    const stored = mem.get(MODULES_STATE_KEY) as ModuleState[];
    expect(stored.find((module) => module.id === 'engagement')).toMatchObject({
      enabled: false,
      dailyLimit: 50,
    });
    expect(stored.every((module) => !('__v_isReactive' in module))).toBe(true);
    unmount();
  });
});
