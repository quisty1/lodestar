import type { KeyValueStore } from '../ports';
import { LLM_PROVIDER_IDS, type LlmProviderId } from './contracts';

/** Storage key for the BYOK LLM config. Lives in chrome.storage.local only. */
export const LLM_CONFIG_KEY = 'llm:config';

/** User-supplied LLM settings (BYOK). The key never leaves the device. */
export interface LlmConfig {
  provider: LlmProviderId;
  apiKey: string;
  /** Chosen model id; provider falls back to its built-in default when unset. */
  model?: string;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = { provider: 'openrouter', apiKey: '' };

export async function loadLlmConfig(store: KeyValueStore): Promise<LlmConfig> {
  const raw = await store.get<LlmConfig>(LLM_CONFIG_KEY);
  if (!raw || !LLM_PROVIDER_IDS.includes(raw.provider)) {
    return DEFAULT_LLM_CONFIG;
  }
  return { provider: raw.provider, apiKey: raw.apiKey ?? '', model: raw.model };
}

export async function saveLlmConfig(store: KeyValueStore, cfg: LlmConfig): Promise<void> {
  await store.set(LLM_CONFIG_KEY, cfg);
}

export function hasLlmKey(cfg: LlmConfig): boolean {
  return cfg.apiKey.trim().length > 0;
}
