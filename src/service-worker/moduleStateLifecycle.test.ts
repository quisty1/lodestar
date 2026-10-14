import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import {
  MODULE_STATE_SCHEMA_VERSION,
  MODULE_STATE_VERSION_KEY,
  MODULES_STATE_KEY,
  defaultModules,
} from '@lib/modules/moduleState';
import { registerModuleStateBootstrap } from './moduleStateLifecycle';

describe('registerModuleStateBootstrap', () => {
  const mem = new Map<string, unknown>();

  beforeEach(() => {
    mem.clear();
    (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: mem.get(key) })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) mem.set(key, value);
          }),
        },
      },
    } as unknown as typeof chrome;
  });

  it('captures onInstalled and seeds module state through Chrome storage', async () => {
    let installed: (() => void) | undefined;
    const onInstalled = {
      addListener: vi.fn((listener: () => void) => {
        installed = listener;
      }),
    };

    registerModuleStateBootstrap(onInstalled, new ChromeStorageStore());
    expect(installed).toBeTypeOf('function');
    installed!();

    await vi.waitFor(() => {
      expect(mem.get(MODULES_STATE_KEY)).toEqual(defaultModules());
      expect(mem.get(MODULE_STATE_VERSION_KEY)).toBe(MODULE_STATE_SCHEMA_VERSION);
    });
  });
});
