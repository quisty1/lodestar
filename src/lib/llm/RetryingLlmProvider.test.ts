import { describe, it, expect } from 'vitest';
import { RetryingLlmProvider } from './RetryingLlmProvider';
import { HttpError } from '../http/HttpError';
import type { LlmProvider, LlmCompletion } from './contracts';

function fakeProvider(complete: () => Promise<LlmCompletion>): LlmProvider {
  return {
    id: 'gemini',
    complete,
    listModels: async () => ({
      models: [{ id: 'gemini-2.5-flash' }],
      source: 'live',
      keyStatus: 'valid',
    }),
  };
}
const done: LlmCompletion = { text: 'ok', model: 'gemini-2.5-flash', provider: 'gemini' };

describe('RetryingLlmProvider', () => {
  it('retries a transient 503 then returns the completion', async () => {
    let n = 0;
    const inner = fakeProvider(async () => {
      if (++n < 2) throw new HttpError(503, 'busy');
      return done;
    });
    const p = new RetryingLlmProvider(inner, { delay: async () => {} });
    expect((await p.complete({ messages: [] })).text).toBe('ok');
    expect(n).toBe(2);
  });

  it('honours a 429 retry delay then succeeds (Gemini free-tier RPM)', async () => {
    const waits: number[] = [];
    let n = 0;
    const inner = fakeProvider(async () => {
      if (++n < 2) throw new HttpError(429, 'rate limited', 22000);
      return done;
    });
    const p = new RetryingLlmProvider(inner, { delay: async (ms) => void waits.push(ms) });
    await p.complete({ messages: [] });
    expect(waits).toEqual([22000]);
  });

  it('propagates a non-retryable error unchanged', async () => {
    const p = new RetryingLlmProvider(
      fakeProvider(async () => {
        throw new HttpError(400, 'bad request');
      }),
      { delay: async () => {} },
    );
    await expect(p.complete({ messages: [] })).rejects.toThrow('bad request');
  });

  it('delegates id + listModels to the inner provider', async () => {
    const p = new RetryingLlmProvider(fakeProvider(async () => done));
    expect(p.id).toBe('gemini');
    expect(await p.listModels()).toEqual({
      models: [{ id: 'gemini-2.5-flash' }],
      source: 'live',
      keyStatus: 'valid',
    });
  });
});
