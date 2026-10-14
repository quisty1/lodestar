import { describe, it, expect } from 'vitest';
import { withRetry, isRetryableError } from './retry';
import { HttpError } from '../http/HttpError';

const noDelay = async () => {};

describe('isRetryableError', () => {
  it('retries 429/500/502/503/504, not 4xx client errors', () => {
    for (const s of [429, 500, 502, 503, 504])
      expect(isRetryableError(new HttpError(s, 'x'))).toBe(true);
    for (const s of [400, 401, 403, 404])
      expect(isRetryableError(new HttpError(s, 'x'))).toBe(false);
  });

  it('falls back to the message for non-HttpError failures', () => {
    expect(isRetryableError(new Error('HTTP 503 Service Unavailable — busy'))).toBe(true);
    expect(isRetryableError(new Error('...RESOURCE_EXHAUSTED...'))).toBe(true);
    expect(isRetryableError(new Error('ideas_not_json'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('retries a transient failure then succeeds', async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        if (++n < 3) throw new HttpError(503, 'busy');
        return 'ok';
      },
      { delay: noDelay },
    );
    expect(r).toBe('ok');
    expect(n).toBe(3);
  });

  it('honours the server-advised retry delay (Gemini 429 "retry in 22s")', async () => {
    const waits: number[] = [];
    let n = 0;
    await withRetry(
      async () => {
        if (++n < 2) throw new HttpError(429, 'rate limited', 22000);
        return 'ok';
      },
      { delay: async (ms) => void waits.push(ms) },
    );
    expect(waits).toEqual([22000]);
  });

  it('uses exponential backoff when the server advises nothing (503)', async () => {
    const waits: number[] = [];
    let n = 0;
    await withRetry(
      async () => {
        if (++n < 4) throw new HttpError(503, 'busy');
        return 'ok';
      },
      { delay: async (ms) => void waits.push(ms), baseDelayMs: 100, rng: () => 0 },
    );
    expect(waits).toEqual([100, 200, 400]);
  });

  it('gives up honestly when the advised wait exceeds the cap (real quota exhaustion)', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new HttpError(429, 'quota gone', 60000);
        },
        { delay: noDelay, maxDelayMs: 30000 },
      ),
    ).rejects.toThrow('quota gone');
    expect(n).toBe(1); // never waited — the wait was too long
  });

  it('does not retry a non-retryable error', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new HttpError(400, 'bad request');
        },
        { delay: noDelay },
      ),
    ).rejects.toThrow('bad request');
    expect(n).toBe(1);
  });

  it('throws the last error after exhausting retries', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new HttpError(503, 'busy');
        },
        { retries: 2, delay: noDelay },
      ),
    ).rejects.toThrow('busy');
    expect(n).toBe(3); // initial + 2 retries
  });
});
