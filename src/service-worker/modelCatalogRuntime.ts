import { LLM_PROVIDER_IDS, type LlmProviderId } from '@lib/llm/contracts';
import { fallbackModelCatalog, type ModelCatalogResult } from '@lib/llm/models';

type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

export interface RuntimeMessageEvent {
  addListener(listener: RuntimeListener): void;
}

export type ListModelsHandler = (
  provider: LlmProviderId,
  apiKey: string,
) => Promise<ModelCatalogResult>;

/** Owns LIST_MODELS async response semantics at the real Chrome runtime boundary. */
export function registerModelCatalogRuntime(
  event: RuntimeMessageEvent,
  listModels: ListModelsHandler,
): void {
  event.addListener((message, _sender, sendResponse) => {
    if (!isRecord(message) || message.type !== 'LIST_MODELS') return false;
    const provider = asProvider(message.provider);
    if (!provider || typeof message.apiKey !== 'string') return false;

    void listModels(provider, message.apiKey).then(sendResponse, () => {
      sendResponse(fallbackModelCatalog(provider, 'unknown', 'runtime_error'));
    });
    return true;
  });
}

function asProvider(value: unknown): LlmProviderId | null {
  return typeof value === 'string' && LLM_PROVIDER_IDS.includes(value as LlmProviderId)
    ? (value as LlmProviderId)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
