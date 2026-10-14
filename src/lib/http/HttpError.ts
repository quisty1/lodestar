/**
 * HTTP error carrying status, full response body and an optional retry delay.
 * Retry/auth layers can classify structured failures without message matching.
 * Extends Error, so existing callers that only read `.message` are unaffected.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs?: number,
    /** Full response body for structured provider error classification. */
    readonly body = '',
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * A request deadline expired and the underlying fetch was aborted.
 * Separate from HttpError because no HTTP response/status was received.
 */
export class HttpTimeoutError extends Error {
  readonly code = 'HTTP_TIMEOUT' as const;

  constructor(
    readonly url: string,
    readonly timeoutMs: number,
    cause?: unknown,
  ) {
    super(`HTTP request timed out after ${timeoutMs}ms: ${url}`, { cause });
    this.name = 'HttpTimeoutError';
  }
}

/**
 * Server-advised retry delay in ms, from a numeric `Retry-After` header (seconds)
 * or a delay hint in the body — e.g. Gemini's free-tier 429 says
 * "Please retry in 21.82s" / `"retryDelay": "7s"`. Returns undefined if none.
 * Note: this reads the FULL body (the hint often sits past the truncated message).
 */
export function parseRetryAfterMs(header: string | null, body: string): number | undefined {
  if (header) {
    const secs = Number(header.trim());
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
  }
  const m = body.match(/retry(?:\s+in|delay["':\s]+)\s*"?([\d.]+)s/i);
  if (m) {
    const v = parseFloat(m[1]);
    if (Number.isFinite(v)) return Math.ceil(v * 1000);
  }
  return undefined;
}
