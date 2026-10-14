import { ref } from 'vue';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import { loadLlmConfig, saveLlmConfig, type LlmConfig } from '@lib/llm/config';
import type {
  LlmKeyStatus,
  LlmModel,
  ModelCatalogResult,
  ModelCatalogSource,
} from '@lib/llm/models';
import { panelBus } from '../lib/panelBus';

/** Settings-screen state for the BYOK LLM config + the loaded model catalog. */
export function useLlmSettings() {
  const store = new ChromeStorageStore();
  const config = ref<LlmConfig>({ provider: 'openrouter', apiKey: '' });
  const models = ref<LlmModel[]>([]);
  const catalogSource = ref<ModelCatalogSource | null>(null);
  const keyStatus = ref<LlmKeyStatus | null>(null);
  const statusReason = ref<string | null>(null);
  const loading = ref(false);
  let requestGeneration = 0;

  async function load() {
    config.value = await loadLlmConfig(store);
  }

  async function save() {
    await saveLlmConfig(store, { ...config.value });
  }

  async function fetchModels() {
    const generation = ++requestGeneration;
    const requestedProvider = config.value.provider;
    const requestedApiKey = config.value.apiKey;
    loading.value = true;
    try {
      const result = await panelBus.request<ModelCatalogResult>({
        type: 'LIST_MODELS',
        provider: requestedProvider,
        apiKey: requestedApiKey,
      });
      if (!ownsRequest(generation, requestedProvider, requestedApiKey)) return;
      if (result === null) {
        markUnchecked('transport_unavailable');
      } else if (!isModelCatalogResult(result)) {
        markUnchecked('protocol_error');
      } else {
        models.value = result.models;
        catalogSource.value = result.source;
        keyStatus.value = result.keyStatus;
        statusReason.value = result.reason ?? null;
      }
    } catch {
      if (ownsRequest(generation, requestedProvider, requestedApiKey)) {
        markUnchecked('transport_unavailable');
      }
    } finally {
      if (generation === requestGeneration) loading.value = false;
    }
  }

  function resetVerification() {
    requestGeneration += 1;
    loading.value = false;
    clearVerification();
  }

  function clearVerification() {
    models.value = [];
    catalogSource.value = null;
    keyStatus.value = null;
    statusReason.value = null;
  }

  function markUnchecked(reason: string) {
    clearVerification();
    keyStatus.value = 'unknown';
    statusReason.value = reason;
  }

  function ownsRequest(generation: number, provider: string, apiKey: string): boolean {
    return (
      generation === requestGeneration &&
      config.value.provider === provider &&
      config.value.apiKey === apiKey
    );
  }

  return {
    config,
    models,
    catalogSource,
    keyStatus,
    statusReason,
    loading,
    load,
    save,
    fetchModels,
    resetVerification,
  };
}

function isModelCatalogResult(value: unknown): value is ModelCatalogResult {
  if (value === null || typeof value !== 'object') return false;
  const result = value as Partial<ModelCatalogResult>;
  return (
    Array.isArray(result.models) &&
    result.models.every(
      (model) => model !== null && typeof model === 'object' && typeof model.id === 'string',
    ) &&
    (result.source === 'live' || result.source === 'fallback') &&
    (result.keyStatus === 'valid' ||
      result.keyStatus === 'invalid' ||
      result.keyStatus === 'unknown')
  );
}
