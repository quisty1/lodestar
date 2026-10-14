import type { HttpClient } from '@lib/llm/contracts';
import type { JsonHttpGet } from '@lib/ssi-api/contracts';
import type { HttpPostText } from '@lib/profileViews/contracts';
import { HttpError, HttpTimeoutError, parseRetryAfterMs } from '@lib/http/HttpError';

export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

/**
 * Thin edge adapter: the only place we touch the global `fetch`.
 *
 * Implements both the LLM POST port and the SSI GET port. `getJson` uses
 * `credentials: 'include'` so the browser attaches the user's LinkedIn session
 * cookies (li_at etc., which are HttpOnly and unreadable from JS) — this is
 * what lets us call `/sales-api/*` authenticated, with host_permissions granted.
 */
export class FetchHttpClient implements HttpClient, JsonHttpGet, HttpPostText {
  constructor(private readonly timeoutMs = DEFAULT_HTTP_TIMEOUT_MS) {}

  async postJson<TResponse>(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<TResponse> {
    return this.withDeadline(url, async (signal) => {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) await this.fail(res);
      return (await res.json()) as TResponse;
    });
  }

  async getJson<TResponse>(url: string, headers: Record<string, string>): Promise<TResponse> {
    return this.withDeadline(url, async (signal) => {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include',
        signal,
      });
      if (!res.ok) await this.fail(res);
      return (await res.json()) as TResponse;
    });
  }

  /**
   * Authenticated POST returning the raw text body — for LinkedIn's SDUI
   * server-request (WVMP), whose response is an RSC flight payload, not JSON.
   * `credentials: 'include'` attaches the session cookies (host_permissions).
   */
  async postText(url: string, headers: Record<string, string>, body: string): Promise<string> {
    return this.withDeadline(url, async (signal) => {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        credentials: 'include',
        signal,
      });
      if (!res.ok) await this.fail(res);
      return res.text();
    });
  }

  private async withDeadline<T>(
    url: string,
    request: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      return await request(controller.signal);
    } catch (error) {
      if (timedOut) throw new HttpTimeoutError(this.safeUrl(url), this.timeoutMs, error);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Avoid leaking query-string API keys into logs/UI through error messages. */
  private safeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url.split(/[?#]/, 1)[0];
    }
  }

  /**
   * Throw a typed HttpError carrying the status + any server-advised retry delay
   * (Retry-After header or a "retry in Xs" hint in the body). Preserves the FULL
   * body for structured classification, but keeps the human message short.
   */
  private async fail(res: Response): Promise<never> {
    const detail = await res.text().catch(() => '');
    throw new HttpError(
      res.status,
      `HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 300)}`,
      parseRetryAfterMs(res.headers.get('retry-after'), detail),
      detail,
    );
  }
}
