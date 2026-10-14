import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchHttpClient } from '@/adapters/FetchHttpClient';
import { listModels } from './contentHandlers';

afterEach(() => vi.unstubAllGlobals());

describe('model catalog fetch → service-worker boundary', () => {
  it('carries Gemini API_KEY_INVALID through the real HTTP adapter and handler', async () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: 'API key not valid. '.repeat(30),
        status: 'INVALID_ARGUMENT',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'API_KEY_INVALID',
            domain: 'googleapis.com',
          },
        ],
      },
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(body, {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await listModels(new FetchHttpClient(), 'gemini', 'bad-key');

    expect(result).toMatchObject({
      source: 'fallback',
      keyStatus: 'invalid',
      reason: 'auth_rejected',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models',
      expect.objectContaining({
        method: 'GET',
        headers: { 'x-goog-api-key': 'bad-key' },
      }),
    );
  });

  it('authenticates OpenRouter before returning its live model catalog', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"data":{"label":"lodestar","is_management_key":false}}', { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o mini' }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await listModels(new FetchHttpClient(), 'openrouter', 'sk-live');

    expect(result).toEqual({
      models: [{ id: 'openai/gpt-4o-mini', label: 'OpenAI: GPT-4o mini' }],
      source: 'live',
      keyStatus: 'valid',
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://openrouter.ai/api/v1/key',
      'https://openrouter.ai/api/v1/models',
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual(
        expect.objectContaining({ headers: { Authorization: 'Bearer sk-live' } }),
      );
    }
  });
});
