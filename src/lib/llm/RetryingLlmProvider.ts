import type { LlmProvider, LlmRequest, LlmCompletion } from './contracts';
import type { ModelCatalogResult } from './models';
import { withRetry, type RetryOptions } from './retry';

/**
 * Decorator (LSP) that retries transient failures (429/5xx) from ANY provider with
 * backoff, honouring a server-advised delay — e.g. direct Gemini's free tier caps
 * at 5 requests/min and returns 429 "retry in Xs"; a single-shot call fails mid-run.
 * `listModels` already falls back internally, so it's passed straight through.
 */
export class RetryingLlmProvider implements LlmProvider {
  readonly id: LlmProvider['id'];

  constructor(
    private readonly inner: LlmProvider,
    private readonly opts?: RetryOptions,
  ) {
    this.id = inner.id;
  }

  complete(request: LlmRequest): Promise<LlmCompletion> {
    return withRetry(() => this.inner.complete(request), this.opts);
  }

  listModels(): Promise<ModelCatalogResult> {
    return this.inner.listModels();
  }
}
