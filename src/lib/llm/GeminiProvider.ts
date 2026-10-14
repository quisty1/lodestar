import type {
  HttpClient,
  HttpGet,
  LlmCompletion,
  LlmProvider,
  LlmProviderConfig,
  LlmRequest,
} from './contracts';
import { toGeminiBody, fromGeminiResponse } from './mappers';
import { HttpError } from '../http/HttpError';
import {
  fallbackModelCatalog,
  liveModelCatalog,
  parseGeminiModels,
  type ModelCatalogResult,
} from './models';

/**
 * Google Gemini API backend (direct). Depends only on the HTTP ports (DIP).
 */
export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini' as const;
  readonly defaultModel: string;
  private readonly apiKey: string;
  private static readonly BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(
    config: LlmProviderConfig,
    private readonly http: HttpClient & HttpGet,
  ) {
    this.defaultModel = config.model ?? 'gemini-2.5-flash';
    this.apiKey = config.apiKey.trim();
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const model = request.model ?? this.defaultModel;
    const url = `${GeminiProvider.BASE}/${model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const body = toGeminiBody(request);
    const res = await this.http.postJson<unknown>(url, body, {
      'Content-Type': 'application/json',
    });
    return { text: fromGeminiResponse(res), model, provider: this.id };
  }

  async listModels(): Promise<ModelCatalogResult> {
    const apiKey = this.apiKey;
    if (!apiKey) return fallbackModelCatalog(this.id, 'invalid', 'empty_key');

    try {
      const raw = await this.http.getJson<unknown>(GeminiProvider.BASE, {
        'x-goog-api-key': apiKey,
      });
      const models = parseGeminiModels(raw);
      return models.length
        ? liveModelCatalog(models)
        : fallbackModelCatalog(this.id, 'valid', 'malformed_catalog');
    } catch (error) {
      const keyStatus = isGeminiAuthRejection(error) ? 'invalid' : 'unknown';
      const reason = keyStatus === 'invalid' ? 'auth_rejected' : 'provider_unavailable';
      return fallbackModelCatalog(this.id, keyStatus, reason);
    }
  }
}

function isGeminiAuthRejection(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false;
  if (error.status === 401 || error.status === 403) return true;
  return containsApiKeyInvalid(error.body);
}

function containsApiKeyInvalid(body: string): boolean {
  try {
    return hasApiKeyInvalid(JSON.parse(body));
  } catch {
    return false;
  }
}

function hasApiKeyInvalid(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (!Array.isArray(value) && (value as Record<string, unknown>).reason === 'API_KEY_INVALID') {
    return true;
  }
  return Object.values(value).some((nested) => hasApiKeyInvalid(nested, depth + 1));
}
