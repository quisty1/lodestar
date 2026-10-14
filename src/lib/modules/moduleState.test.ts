import { describe, expect, it, vi } from 'vitest';
import { FakeStore } from '../storage/fakeStore';
import type { ModuleState } from '../types';
import {
  MODULE_STATE_SCHEMA_VERSION,
  MODULE_STATE_VERSION_KEY,
  MODULES_STATE_KEY,
  UnsupportedModuleStateVersionError,
  bootstrapModuleState,
  defaultModules,
  normalizeModuleState,
} from './moduleState';

describe('normalizeModuleState', () => {
  it('uses the complete default roster for fresh storage', () => {
    const result = normalizeModuleState(null);

    expect(result.modules).toEqual(defaultModules());
    expect(result.migrated).toBe(true);
  });

  it('preserves an intentional all-disabled saved roster', () => {
    const saved = defaultModules().map((module) => ({ ...module, enabled: false }));

    const result = normalizeModuleState(saved);

    expect(result.modules.every((module) => !module.enabled)).toBe(true);
    expect(result.migrated).toBe(false);
  });

  it('backfills stale fields and pins availability to the current build', () => {
    const result = normalizeModuleState([
      { id: 'engagement', enabled: false, available: false },
      {
        id: 'smart_connect',
        enabled: true,
        automationLevel: 'full_auto',
        available: false,
        dailyLimit: 77,
      },
      { id: 'removed_module', enabled: true },
    ]);

    expect(result.modules).toEqual([
      { ...defaultModules()[0], enabled: false },
      { ...defaultModules()[1], enabled: true, automationLevel: 'full_auto', dailyLimit: 77 },
      defaultModules()[2],
      defaultModules()[3],
    ]);
    expect(result.migrated).toBe(true);
  });

  it('recovers the numeric-key object written from a reactive array', () => {
    const saved = defaultModules().map((module) => ({ ...module, enabled: false }));
    const corruptShape = Object.fromEntries(saved.map((module, index) => [String(index), module]));

    const result = normalizeModuleState(corruptShape);

    expect(result.modules).toEqual(saved);
    expect(Array.isArray(result.modules)).toBe(true);
    expect(
      result.modules.every((module) => Object.getPrototypeOf(module) === Object.prototype),
    ).toBe(true);
    expect(result.migrated).toBe(true);
  });
});

describe('bootstrapModuleState', () => {
  it('persists fresh defaults and the current schema version', async () => {
    const store = new FakeStore();

    const modules = await bootstrapModuleState(store);

    expect(modules).toEqual(defaultModules());
    expect(store.data.get(MODULES_STATE_KEY)).toEqual(defaultModules());
    expect(store.data.get(MODULE_STATE_VERSION_KEY)).toBe(MODULE_STATE_SCHEMA_VERSION);
  });

  it('rewrites a valid roster when only the schema version is stale', async () => {
    const store = new FakeStore();
    const saved: ModuleState[] = defaultModules().map((module) => ({ ...module, enabled: false }));
    store.data.set(MODULES_STATE_KEY, saved);
    store.data.set(MODULE_STATE_VERSION_KEY, 0);

    const modules = await bootstrapModuleState(store);

    expect(modules).toEqual(saved);
    expect(store.data.get(MODULES_STATE_KEY)).toEqual(saved);
    expect(store.data.get(MODULE_STATE_VERSION_KEY)).toBe(MODULE_STATE_SCHEMA_VERSION);
  });

  it('rejects a future schema without modifying its unknown fields or version', async () => {
    const store = new FakeStore();
    const futureState = [
      ...defaultModules(),
      { id: 'future_module', enabled: true, available: true, futureSetting: { keep: true } },
    ];
    store.data.set(MODULES_STATE_KEY, futureState);
    store.data.set(MODULE_STATE_VERSION_KEY, MODULE_STATE_SCHEMA_VERSION + 1);
    const set = vi.spyOn(store, 'set');

    await expect(bootstrapModuleState(store)).rejects.toEqual(
      new UnsupportedModuleStateVersionError(MODULE_STATE_SCHEMA_VERSION + 1),
    );
    expect(set).not.toHaveBeenCalled();
    expect(store.data.get(MODULES_STATE_KEY)).toBe(futureState);
    expect(store.data.get(MODULE_STATE_VERSION_KEY)).toBe(MODULE_STATE_SCHEMA_VERSION + 1);
  });
});
