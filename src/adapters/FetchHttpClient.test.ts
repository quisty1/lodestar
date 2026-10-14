import { describe, it, expect, vi, afterEach } from 'vitest';
import { FetchHttpClient } from './FetchHttpClient';
import { HttpError, HttpTimeoutError } from '@lib/http/HttpError';

const respond = (status: number, body: string, headers: Record<string, string> = {}) =>
  vi.fn(
    async () =>
      new Response(body, {
        status,
        statusText: status === 429 ? 'Too Many Requests' : 'OK',
        headers,
      }),
  );

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Crosses the HTTP boundary: the retry layer relies on FetchHttpClient producing a
// typed HttpError with the status + server-advised delay from a REAL Gemini 429 body.
describe('FetchHttpClient error boundary', () => {
  const catchErr = async (fn: () => Promise<unknown>): Promise<HttpError> => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof HttpError) return e;
      throw e;
    }
    throw new Error('expected a rejection');
  };

  it('throws HttpError(status, retryAfterMs) on a real Gemini free-tier 429', async () => {
    const body =
      '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-2.5-flash\\nPlease retry in 21.820828702s.","status":"RESOURCE_EXHAUSTED"}}';
    vi.stubGlobal('fetch', respond(429, body));

    const err = await catchErr(() => new FetchHttpClient().postJson('https://x', {}, {}));
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(21821);
    expect(err.body).toBe(body);
  });

  it('preserves the full body even though the human error message is truncated', async () => {
    const body = `${'x'.repeat(400)}API_KEY_INVALID`;
    vi.stubGlobal('fetch', respond(400, body));

    const err = await catchErr(() => new FetchHttpClient().getJson('https://x', {}));

    expect(err.message).not.toContain('API_KEY_INVALID');
    expect(err.body).toBe(body);
  });

  it('prefers a numeric Retry-After header when present (503)', async () => {
    vi.stubGlobal('fetch', respond(503, 'overloaded', { 'retry-after': '5' }));
    const err = await catchErr(() => new FetchHttpClient().getJson('https://x', {}));
    expect(err.status).toBe(503);
    expect(err.retryAfterMs).toBe(5000);
  });

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', respond(200, '{"ok":true}'));
    expect(await new FetchHttpClient().postJson('https://x', {}, {})).toEqual({ ok: true });
  });
});

describe('FetchHttpClient request deadline', () => {
  const requestMethods = [
    ['postJson', (client: FetchHttpClient) => client.postJson('https://x/post-json', {}, {})],
    ['getJson', (client: FetchHttpClient) => client.getJson('https://x/get-json', {})],
    ['postText', (client: FetchHttpClient) => client.postText('https://x/post-text', {}, 'body')],
  ] as const;

  it.each(requestMethods)(
    'passes an AbortSignal and clears the timer after %s succeeds',
    async (_name, request) => {
      vi.useFakeTimers();
      const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(init?.signal?.aborted).toBe(false);
        return new Response('{"ok":true}', { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);

      await request(new FetchHttpClient(25));

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('clears the timer after an HTTP error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', respond(503, 'overloaded'));

    await expect(new FetchHttpClient(25).getJson('https://x', {})).rejects.toBeInstanceOf(
      HttpError,
    );

    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a hung fetch and rejects with a distinguishable typed timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) return Promise.reject(new Error('missing AbortSignal'));

      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = new FetchHttpClient(25)
      .postJson('https://x/hung?key=must-not-leak', {}, {})
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(24);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const error = await request;
    expect(error).toBeInstanceOf(HttpTimeoutError);
    expect(error).toMatchObject({
      name: 'HttpTimeoutError',
      code: 'HTTP_TIMEOUT',
      url: 'https://x/hung',
      timeoutMs: 25,
    });
    expect((error as Error).message).not.toContain('must-not-leak');
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses a 30 second deadline by default', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        if (!signal) return Promise.reject(new Error('missing AbortSignal'));

        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            },
            { once: true },
          );
        });
      }),
    );

    const request = new FetchHttpClient()
      .getJson('https://x/default-timeout', {})
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toMatchObject({
      name: 'HttpTimeoutError',
      timeoutMs: 30_000,
    });
    expect(signal?.aborted).toBe(true);
  });
});
