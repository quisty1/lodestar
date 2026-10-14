import type { KeyValueStore } from '../ports';
import type {
  ActionType,
  AutomationLevel,
  ExpertiseProfile,
  Guardrails,
  ModuleId,
  ModuleState,
  TargetProfile,
} from '../types';

export interface EngagementConfig {
  level: AutomationLevel;
  guardrails: Guardrails;
  /** Per-action-type daily caps . */
  dailyLimits: Record<ActionType, number>;
}

export const SETTINGS_KEY = 'engagement:settings';
// Owned by the side panel's useModules — the single source of truth for
// per-module automationLevel. Keep this key in sync with that composable.
const MODULES_STATE_KEY = 'modules:state';

export interface EngagementSettings {
  config: EngagementConfig;
  target: TargetProfile;
  expertise: ExpertiseProfile;
  /** Minimum RelevanceScorer score (0..1) for a post to be worth engaging. */
  relevanceThreshold: number;
}

/** Safe defaults: manual approval, conservative budgets. */
export const DEFAULT_SETTINGS: EngagementSettings = {
  config: {
    level: 'manual',
    guardrails: {
      minConfidence: 0.6,
      bannedPhrases: ['great post', 'thanks for sharing', 'well said'],
      quarantineMinutes: 10,
      lenRange: [12, 280],
    },
    dailyLimits: { like: 60, comment: 10, connect: 0, post: 0 },
  },
  target: {
    stack: [],
    targetRoles: ['recruiter', 'talent', 'hiring'],
    geos: [],
    watchlistCompanies: [],
  },
  expertise: { headline: '', stack: [] },
  relevanceThreshold: 0.3,
};

export async function loadSettings(store: KeyValueStore): Promise<EngagementSettings> {
  const base = (await store.get<EngagementSettings>(SETTINGS_KEY)) ?? DEFAULT_SETTINGS;
  // automationLevel is owned by the module roster. Mirror it onto config.level
  // so a stored settings blob stays consistent with the roster.
  const modules = asArray<ModuleState>(await store.get<ModuleState[]>(MODULES_STATE_KEY));
  const engagement = modules.find((m) => m?.id === 'engagement');
  if (!engagement) return base;
  return {
    ...base,
    config: { ...base.config, level: engagement.automationLevel },
  };
}

/**
 * Coerce a stored value to an array. chrome.storage serialises a Vue reactive
 * array as an array-like object `{0:..,1:..}`, so a plain Array.isArray check
 * would wrongly discard valid data; Object.values rescues it. Garbage → [].
 */
export function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value !== null && typeof value === 'object') return Object.values(value) as T[];
  return [];
}

/**
 * A module's per-day budget (its `dailyLimit`) from the persisted roster, with a
 * fallback when missing or zero. SSOT for reading a module limit (likes/day,
 * ideas/day, …). Guards the array-as-object shape.
 */
export function moduleLimit(modulesState: unknown, id: ModuleId, fallback: number): number {
  const n = asArray<ModuleState>(modulesState).find((x) => x?.id === id)?.dailyLimit;
  return typeof n === 'number' && n > 0 ? n : fallback;
}

export async function saveSettings(
  store: KeyValueStore,
  settings: EngagementSettings,
): Promise<void> {
  await store.set(SETTINGS_KEY, settings);
}

/** Split a comma-separated input into trimmed, non-empty tokens. */
export function parseCsv(input: string): string[] {
  return input
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

export interface TargetForm {
  stack: string;
  roles: string;
  threshold: number;
}

/** Apply the target form to settings (stack/roles/threshold), preserving the rest. */
export function applyTargetForm(current: EngagementSettings, form: TargetForm): EngagementSettings {
  return {
    ...current,
    target: {
      ...current.target,
      stack: parseCsv(form.stack),
      targetRoles: parseCsv(form.roles),
    },
    relevanceThreshold: Math.min(1, Math.max(0, form.threshold)),
  };
}

export interface ExpertiseForm {
  headline: string;
  stack: string;
  bio: string;
}

/** Apply the expertise form, preserving target/config/threshold (no clobber). */
export function applyExpertiseForm(
  current: EngagementSettings,
  form: ExpertiseForm,
): EngagementSettings {
  const bio = form.bio.trim();
  return {
    ...current,
    expertise: {
      headline: form.headline.trim(),
      stack: parseCsv(form.stack),
      ...(bio ? { bio } : {}),
    },
  };
}
