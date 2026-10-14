import type {
  HttpClient,
  HttpGet,
  LlmCompletion,
  LlmProvider,
  LlmProviderConfig,
  LlmRequest,
} from './contracts';
import { toOpenRouterBody, fromOpenRouterResponse } from './mappers';
import { HttpError } from '../http/HttpError';
import {
  fallbackModelCatalog,
  liveModelCatalog,
  parseOpenRouterModels,
  type ModelCatalogResult,
} from './models';

/**
 * OpenRouter backend (OpenAI-compatible). Depends only on the HTTP ports (DIP) —
 * no direct `fetch`, so it is fully unit-testable with a fake.
 */
export class OpenRouterProvider implements LlmProvider {
  readonly id = 'openrouter' as const;
  readonly defaultModel: string;
  private readonly apiKey: string;
  private static readonly ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
  private static readonly KEY = 'https://openrouter.ai/api/v1/key';
  private static readonly MODELS = 'https://openrouter.ai/api/v1/models';

  constructor(
    config: LlmProviderConfig,
    private readonly http: HttpClient & HttpGet,
  ) {
    this.defaultModel = config.model ?? 'google/gemini-2.5-flash-lite';
    this.apiKey = config.apiKey.trim();
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const body = toOpenRouterBody(request, this.defaultModel);
    const res = await this.http.postJson<unknown>(OpenRouterProvider.ENDPOINT, body, {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    });
    return { text: fromOpenRouterResponse(res), model: body.model, provider: this.id };
  }

  async listModels(): Promise<ModelCatalogResult> {
    const apiKey = this.apiKey;
    if (!apiKey) return fallbackModelCatalog(this.id, 'invalid', 'empty_key');
    const headers = { Authorization: `Bearer ${apiKey}` };

    let keyType: 'completion' | 'management' | 'malformed';
    try {
      keyType = openRouterKeyType(
        await this.http.getJson<unknown>(OpenRouterProvider.KEY, headers),
      );
    } catch (error) {
      const keyStatus = isAuthRejection(error) ? 'invalid' : 'unknown';
      const reason = keyStatus === 'invalid' ? 'auth_rejected' : 'provider_unavailable';
      return fallbackModelCatalog(this.id, keyStatus, reason);
    }
    if (keyType === 'management') {
      return fallbackModelCatalog(this.id, 'invalid', 'management_key');
    }
    if (keyType === 'malformed') {
      return fallbackModelCatalog(this.id, 'unknown', 'malformed_auth_response');
    }

    try {
      const raw = await this.http.getJson<unknown>(OpenRouterProvider.MODELS, headers);
      const models = parseOpenRouterModels(raw);
      return models.length
        ? liveModelCatalog(models)
        : fallbackModelCatalog(this.id, 'valid', 'malformed_catalog');
    } catch {
      return fallbackModelCatalog(this.id, 'valid', 'catalog_unavailable');
    }
  }
}

function isAuthRejection(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 401 || error.status === 403);
}

function openRouterKeyType(value: unknown): 'completion' | 'management' | 'malformed' {
  if (!value || typeof value !== 'object') return 'malformed';
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return 'malformed';
  const flag = (data as { is_management_key?: unknown }).is_management_key;
  if (typeof flag !== 'boolean') return 'malformed';
  return flag ? 'management' : 'completion';
}
