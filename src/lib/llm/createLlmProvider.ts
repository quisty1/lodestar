import type {
  HttpClient,
  HttpGet,
  LlmProvider,
  LlmProviderConfig,
  LlmProviderId,
} from './contracts';
import { OpenRouterProvider } from './OpenRouterProvider';
import { GeminiProvider } from './GeminiProvider';
import { RetryingLlmProvider } from './RetryingLlmProvider';

/**
 * Composition root for the LLM layer. A registry keyed by provider id keeps
 * this open for extension (add a row to support a new backend) and closed for
 * modification (no growing switch) — OCP.
 */
const REGISTRY: Record<
  LlmProviderId,
  (config: LlmProviderConfig, http: HttpClient & HttpGet) => LlmProvider
> = {
  openrouter: (config, http) => new OpenRouterProvider(config, http),
  gemini: (config, http) => new GeminiProvider(config, http),
};

export function createLlmProvider(
  config: LlmProviderConfig,
  http: HttpClient & HttpGet,
): LlmProvider {
  const factory = REGISTRY[config.provider];
  if (!factory) {
    throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
  // Wrap every provider in transient-failure retry. Direct Gemini's free tier
  // (5 req/min) returns 429/503 mid-run; a single-shot call fails silently otherwise.
  return new RetryingLlmProvider(factory(config, http));
}
