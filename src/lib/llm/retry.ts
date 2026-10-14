import { HttpError } from '../http/HttpError';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** True for transient HTTP failures worth retrying (overload / rate-limit / gateway). */
export function isRetryableError(e: unknown): boolean {
  if (e instanceof HttpError) return RETRYABLE_STATUS.has(e.status);
  // Fallback for errors that aren't typed (message shape from FetchHttpClient).
  const msg = e instanceof Error ? e.message : String(e);
  return (
    /\bHTTP (429|500|502|503|504)\b/.test(msg) || /\b(UNAVAILABLE|RESOURCE_EXHAUSTED)\b/.test(msg)
  );
}

/** The server-advised wait (ms), when the error carries one. */
export function advisedRetryMs(e: unknown): number | undefined {
  return e instanceof HttpError ? e.retryAfterMs : undefined;
}

export interface RetryOptions {
  /** Max retries after the first attempt (default 3). */
  retries?: number;
  /** Base for exponential backoff when the server gives no advice (default 500ms). */
  baseDelayMs?: number;
  /** Hard cap: if the required wait exceeds this, give up honestly (default 30s). */
  maxDelayMs?: number;
  isRetryable?: (e: unknown) => boolean;
  advisedDelayMs?: (e: unknown) => number | undefined;
  delay?: (ms: number) => Promise<void>;
  rng?: () => number;
}

/**
 * Run `fn`, retrying transient failures with backoff. Honours a server-advised
 * delay (e.g. Gemini free-tier's "retry in Xs" — the 5 req/min limit) when present,
 * otherwise exponential backoff with jitter. Gives up (throws the error) on a
 * non-retryable failure, after exhausting retries, or when the required wait
 * exceeds `maxDelayMs` (real quota exhaustion → surface the honest error, don't
 * stall forever). Pure: inject `delay`/`rng` in tests. SW-safe: bounded waits.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 30_000;
  const isRetryable = opts.isRetryable ?? isRetryableError;
  const advised = opts.advisedDelayMs ?? advisedRetryMs;
  const delay = opts.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const rng = opts.rng ?? Math.random;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      const wait = advised(e) ?? Math.floor(base * 2 ** attempt + rng() * base);
      if (wait > max) throw e;
      await delay(wait);
    }
  }
}
