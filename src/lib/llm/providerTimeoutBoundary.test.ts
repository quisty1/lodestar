import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchHttpClient } from '@/adapters/FetchHttpClient';
import { GeminiProvider } from './GeminiProvider';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LLM provider HTTP timeout boundary', () => {
  it('settles a completion when the provider fetch only reacts to abort', async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        observedSignal = init?.signal ?? undefined;
        if (!observedSignal) return Promise.reject(new Error('missing AbortSignal'));

        return new Promise<Response>((_resolve, reject) => {
          observedSignal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            },
            { once: true },
          );
        });
      }),
    );
    const provider = new GeminiProvider(
      { provider: 'gemini', apiKey: 'test-key' },
      new FetchHttpClient(40),
    );

    const completion = provider
      .complete({ messages: [{ role: 'user', content: 'hello' }] })
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(39);
    expect(observedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(completion).resolves.toMatchObject({
      name: 'HttpTimeoutError',
      code: 'HTTP_TIMEOUT',
      timeoutMs: 40,
    });
    expect(observedSignal?.aborted).toBe(true);
  });
});
