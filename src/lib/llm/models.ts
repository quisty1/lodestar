import type { LlmProviderId } from './contracts';

/** A selectable model in the settings dropdown. */
export interface LlmModel {
  id: string;
  label?: string;
}

export type ModelCatalogSource = 'live' | 'fallback';
export type LlmKeyStatus = 'valid' | 'invalid' | 'unknown';

/** Catalog payload keeps model availability separate from authentication truth. */
export interface ModelCatalogResult {
  models: LlmModel[];
  source: ModelCatalogSource;
  keyStatus: LlmKeyStatus;
  reason?: string;
}

/** Curated choices shown when the live catalog is unavailable; never auth proof. */
export const FALLBACK_MODELS: Record<LlmProviderId, LlmModel[]> = {
  openrouter: [
    { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  ],
};

export function fallbackModelCatalog(
  provider: LlmProviderId,
  keyStatus: LlmKeyStatus,
  reason: string,
): ModelCatalogResult {
  return { models: FALLBACK_MODELS[provider], source: 'fallback', keyStatus, reason };
}

export function liveModelCatalog(models: LlmModel[]): ModelCatalogResult {
  return { models, source: 'live', keyStatus: 'valid' };
}

interface OpenRouterModelsResponse {
  data?: { id?: unknown; name?: unknown }[];
}
interface GeminiModelsResponse {
  models?: { name?: unknown; displayName?: unknown; supportedGenerationMethods?: unknown }[];
}

export function parseOpenRouterModels(raw: unknown): LlmModel[] {
  const data = (raw as OpenRouterModelsResponse)?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((m) => typeof m?.id === 'string' && m.id.length > 0)
    .map((m) => ({
      id: m.id as string,
      label: typeof m.name === 'string' ? m.name : undefined,
    }));
}

export function parseGeminiModels(raw: unknown): LlmModel[] {
  const models = (raw as GeminiModelsResponse)?.models;
  if (!Array.isArray(models)) return [];
  return models
    .filter(
      (m) =>
        typeof m?.name === 'string' &&
        Array.isArray(m.supportedGenerationMethods) &&
        (m.supportedGenerationMethods as unknown[]).includes('generateContent'),
    )
    .map((m) => ({
      id: (m.name as string).replace(/^models\//, ''),
      label: typeof m.displayName === 'string' ? m.displayName : undefined,
    }));
}
