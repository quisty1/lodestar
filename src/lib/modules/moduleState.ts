import type { KeyValueStore } from '../ports';
import type { AutomationLevel, ModuleId, ModuleState } from '../types';

export const MODULES_STATE_KEY = 'modules:state';
export const MODULE_STATE_VERSION_KEY = 'modules:state:version';
export const MODULE_STATE_SCHEMA_VERSION = 1;

export class UnsupportedModuleStateVersionError extends Error {
  readonly supportedVersion = MODULE_STATE_SCHEMA_VERSION;

  constructor(readonly storedVersion: number) {
    super(
      `Unsupported module state version ${storedVersion}; this build supports ${MODULE_STATE_SCHEMA_VERSION}`,
    );
    this.name = 'UnsupportedModuleStateVersionError';
  }
}

const AUTOMATION_LEVELS = new Set<AutomationLevel>(['manual', 'auto_guardrails', 'full_auto']);

const DEFAULT_MODULES: readonly ModuleState[] = [
  { id: 'engagement', enabled: true, automationLevel: 'manual', available: true, dailyLimit: 35 },
  {
    id: 'smart_connect',
    enabled: false,
    automationLevel: 'manual',
    available: true,
    dailyLimit: 100,
  },
  { id: 'content', enabled: false, automationLevel: 'manual', available: true, dailyLimit: 10 },
  {
    id: 'profile_views',
    enabled: false,
    automationLevel: 'manual',
    available: true,
    dailyLimit: 40,
  },
];

/** Current module roster. Always returns detached plain objects. */
export function defaultModules(): ModuleState[] {
  return DEFAULT_MODULES.map((module) => ({ ...module }));
}

export interface NormalizedModuleState {
  modules: ModuleState[];
  /** Storage should be rewritten because its shape or values were stale/corrupt. */
  migrated: boolean;
}

/**
 * Converts every historical storage shape to the current roster.
 * Saved user choices win; build-owned availability and missing fields come from defaults.
 */
export function normalizeModuleState(raw: unknown): NormalizedModuleState {
  const { entries, recoveredObject } = storedEntries(raw);
  const byId = new Map<ModuleId, Record<string, unknown>>();

  for (const entry of entries) {
    if (!isRecord(entry) || !isModuleId(entry.id) || byId.has(entry.id)) continue;
    byId.set(entry.id, entry);
  }

  const modules = defaultModules().map((fallback) =>
    normalizeModule(byId.get(fallback.id), fallback),
  );
  const migrated = recoveredObject || !isCurrentRoster(raw, modules);
  return { modules, migrated };
}

/**
 * Loads the module SSOT and persists defaults/migrations before returning it.
 * Keeping the existing `modules:state` key preserves all current readers.
 */
export async function bootstrapModuleState(store: KeyValueStore): Promise<ModuleState[]> {
  const [raw, version] = await Promise.all([
    store.get<unknown>(MODULES_STATE_KEY),
    store.get<number>(MODULE_STATE_VERSION_KEY),
  ]);
  // A newer build may own fields/modules this build cannot understand. Never
  // normalize or stamp that state as v1: doing so would destroy forward data.
  if (typeof version === 'number' && version > MODULE_STATE_SCHEMA_VERSION) {
    throw new UnsupportedModuleStateVersionError(version);
  }
  const normalized = normalizeModuleState(raw);

  if (normalized.migrated || version !== MODULE_STATE_SCHEMA_VERSION) {
    await store.set(MODULES_STATE_KEY, cloneModules(normalized.modules));
    await store.set(MODULE_STATE_VERSION_KEY, MODULE_STATE_SCHEMA_VERSION);
  }

  return cloneModules(normalized.modules);
}

function normalizeModule(
  saved: Record<string, unknown> | undefined,
  fallback: ModuleState,
): ModuleState {
  const automationLevel = saved?.automationLevel;
  const dailyLimit = saved?.dailyLimit;
  return {
    id: fallback.id,
    enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : fallback.enabled,
    automationLevel:
      typeof automationLevel === 'string' &&
      AUTOMATION_LEVELS.has(automationLevel as AutomationLevel)
        ? (automationLevel as AutomationLevel)
        : fallback.automationLevel,
    available: fallback.available,
    dailyLimit:
      typeof dailyLimit === 'number' && Number.isFinite(dailyLimit) && dailyLimit >= 0
        ? Math.round(dailyLimit)
        : fallback.dailyLimit,
  };
}

function storedEntries(raw: unknown): { entries: unknown[]; recoveredObject: boolean } {
  if (Array.isArray(raw)) return { entries: raw, recoveredObject: false };
  if (!isRecord(raw)) return { entries: [], recoveredObject: false };

  const numericKeys = Object.keys(raw)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b));
  return { entries: numericKeys.map((key) => raw[key]), recoveredObject: true };
}

function isCurrentRoster(raw: unknown, normalized: ModuleState[]): boolean {
  if (!Array.isArray(raw) || raw.length !== normalized.length) return false;
  const entries = raw.map((entry: unknown) => entry);
  return normalized.every((module, index) => {
    const saved = entries[index];
    if (!isRecord(saved) || Object.keys(saved).length !== 5) return false;
    return (
      saved.id === module.id &&
      saved.enabled === module.enabled &&
      saved.automationLevel === module.automationLevel &&
      saved.available === module.available &&
      saved.dailyLimit === module.dailyLimit
    );
  });
}

function cloneModules(modules: ModuleState[]): ModuleState[] {
  return modules.map((module) => ({ ...module }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isModuleId(value: unknown): value is ModuleId {
  return typeof value === 'string' && DEFAULT_MODULES.some((module) => module.id === value);
}
