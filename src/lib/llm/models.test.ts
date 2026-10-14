import { describe, expect, it } from 'vitest';
import { HttpError } from '../http/HttpError';
import { GeminiProvider } from './GeminiProvider';
import { OpenRouterProvider } from './OpenRouterProvider';
import type { HttpClient, HttpGet } from './contracts';
import { FALLBACK_MODELS, parseGeminiModels, parseOpenRouterModels } from './models';

interface GetCall {
  url: string;
  headers: Record<string, string>;
}

interface PostCall {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Ordered GET fake: each call consumes one realistic response or error. */
class FakeHttp implements HttpClient, HttpGet {
  readonly getCalls: GetCall[] = [];
  readonly postCalls: PostCall[] = [];

  constructor(
    private readonly getSteps: unknown[],
    private readonly postResult: unknown = {},
  ) {}

  async postJson<T>(url: string, body: unknown, headers: Record<string, string>): Promise<T> {
    this.postCalls.push({ url, body, headers });
    return this.postResult as T;
  }

  async getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
    this.getCalls.push({ url, headers });
    const step = this.getSteps.shift();
    if (step instanceof Error) throw step;
    return step as T;
  }
}

const OPENROUTER_RAW = {
  data: [
    { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
    { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash' },
  ],
};

const OPENROUTER_KEY = { data: { label: 'lodestar', is_management_key: false } };

const GEMINI_RAW = {
  models: [
    {
      name: 'models/gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      supportedGenerationMethods: ['generateContent', 'countTokens'],
    },
    {
      name: 'models/embedding-001',
      displayName: 'Embedding 001',
      supportedGenerationMethods: ['embedContent'],
    },
  ],
};

describe('model catalog parsers', () => {
  it('maps OpenRouter data[].id/name', () => {
    expect(parseOpenRouterModels(OPENROUTER_RAW)).toEqual([
      { id: 'openai/gpt-4o', label: 'OpenAI: GPT-4o' },
      { id: 'google/gemini-2.5-flash', label: 'Google: Gemini 2.5 Flash' },
    ]);
  });

  it('keeps Gemini generateContent models and strips the models/ prefix', () => {
    expect(parseGeminiModels(GEMINI_RAW)).toEqual([
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ]);
  });
});

describe('OpenRouterProvider.listModels', () => {
  it('authenticates first, then loads models with the Bearer key', async () => {
    const http = new FakeHttp([OPENROUTER_KEY, OPENROUTER_RAW]);
    const result = await new OpenRouterProvider(
      { provider: 'openrouter', apiKey: 'sk-live' },
      http,
    ).listModels();

    expect(http.getCalls).toEqual([
      { url: 'https://openrouter.ai/api/v1/key', headers: { Authorization: 'Bearer sk-live' } },
      { url: 'https://openrouter.ai/api/v1/models', headers: { Authorization: 'Bearer sk-live' } },
    ]);
    expect(result).toEqual({
      models: parseOpenRouterModels(OPENROUTER_RAW),
      source: 'live',
      keyStatus: 'valid',
    });
  });

  it('rejects an empty key locally without touching HTTP', async () => {
    const http = new FakeHttp([]);
    const result = await new OpenRouterProvider(
      { provider: 'openrouter', apiKey: '   ' },
      http,
    ).listModels();

    expect(http.getCalls).toEqual([]);
    expect(result).toEqual({
      models: FALLBACK_MODELS.openrouter,
      source: 'fallback',
      keyStatus: 'invalid',
      reason: 'empty_key',
    });
  });

  it('marks an explicit authentication rejection invalid', async () => {
    const http = new FakeHttp([new HttpError(401, 'Unauthorized')]);
    const result = await new OpenRouterProvider(
      { provider: 'openrouter', apiKey: 'bad' },
      http,
    ).listModels();

    expect(http.getCalls).toHaveLength(1);
    expect(result).toMatchObject({
      source: 'fallback',
      keyStatus: 'invalid',
      reason: 'auth_rejected',
    });
  });

  it.each([
    ['network failure', new TypeError('Failed to fetch')],
    ['rate limit', new HttpError(429, 'Too Many Requests')],
    ['provider outage', new HttpError(503, 'Unavailable')],
  ])('does not reject the key when authentication has a %s', async (_label, error) => {
    const http = new FakeHttp([error]);
    const result = await new OpenRouterProvider(
      { provider: 'openrouter', apiKey: 'not-checked' },
      http,
    ).listModels();

    expect(result).toMatchObject({
      source: 'fallback',
      keyStatus: 'unknown',
      reason: 'provider_unavailable',
    });
  });

  it('keeps a successfully authenticated key valid when the catalog is malformed', async () => {
    const http = new FakeHttp([OPENROUTER_KEY, { unexpected: true }]);
    const result = await new OpenRouterProvider(
      { provider: 'openrouter', apiKey: 'sk-live' },
      http,
    ).listModels();

    expect(result).toEqual({
      models: FALLBACK_MODELS.openrouter,
      source: 'fallback',
      keyStatus: 'valid',
      reason: 'malformed_catalog',
    });
  });

  it('uses the same trimmed credential for verification and completion', async () => {
    const http = new FakeHttp([OPENROUTER_KEY, OPENROUTER_RAW], {
      choices: [{ message: { content: 'ok' } }],
    });
    const provider = new OpenRouterProvider(
      { provider: 'openrouter', apiKey: '  sk-live  ' },
      http,
    );

    await provider.listModels();
    await provider.complete({ messages: [{ role: 'user', content: 'hello' }] });

    expect(http.getCalls[0]?.headers).toEqual({ Authorization: 'Bearer sk-live' });
    expect(http.postCalls[0]?.headers.Authorization).toBe('Bearer sk-live');
  });

  it('rejects a management key before loading a completion model catalog', async () => {
    const http = new FakeHttp([
      { data: { label: 'admin', is_management_key: true } },
      OPENROUTER_RAW,
    ]);

    const result = await new OpenRouterProvider(
      { provider: 'openrouter', apiKey: 'sk-admin' },
      http,
    ).listModels();

    expect(result).toMatchObject({
      source: 'fallback',
      keyStatus: 'invalid',
      reason: 'management_key',
    });
    expect(http.getCalls).toHaveLength(1);
  });

  it('does not claim validity from a malformed current-key response', async () => {
    const http = new FakeHttp([{ data: { label: 'missing-key-type' } }, OPENROUTER_RAW]);

    const result = await new OpenRouterProvider(
      { provider: 'openrouter', apiKey: 'sk-unknown' },
      http,
    ).listModels();

    expect(result).toMatchObject({
      source: 'fallback',
      keyStatus: 'unknown',
      reason: 'malformed_auth_response',
    });
    expect(http.getCalls).toHaveLength(1);
  });
});

describe('GeminiProvider.listModels', () => {
  it('loads models with x-goog-api-key and reports live authenticated data', async () => {
    const http = new FakeHttp([GEMINI_RAW]);
    const result = await new GeminiProvider(
      { provider: 'gemini', apiKey: 'AIza-live' },
      http,
    ).listModels();

    expect(http.getCalls).toEqual([
      {
        url: 'https://generativelanguage.googleapis.com/v1beta/models',
        headers: { 'x-goog-api-key': 'AIza-live' },
      },
    ]);
    expect(result).toEqual({
      models: parseGeminiModels(GEMINI_RAW),
      source: 'live',
      keyStatus: 'valid',
    });
  });

  it('rejects an empty key locally without touching HTTP', async () => {
    const http = new FakeHttp([]);
    const result = await new GeminiProvider({ provider: 'gemini', apiKey: '' }, http).listModels();

    expect(http.getCalls).toEqual([]);
    expect(result).toEqual({
      models: FALLBACK_MODELS.gemini,
      source: 'fallback',
      keyStatus: 'invalid',
      reason: 'empty_key',
    });
  });

  it('classifies structured API_KEY_INVALID from the full HTTP body', async () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: 'x'.repeat(400),
        status: 'INVALID_ARGUMENT',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' },
        ],
      },
    });
    const http = new FakeHttp([new HttpError(400, 'HTTP 400 — truncated', undefined, body)]);
    const result = await new GeminiProvider(
      { provider: 'gemini', apiKey: 'bad' },
      http,
    ).listModels();

    expect(result).toMatchObject({
      source: 'fallback',
      keyStatus: 'invalid',
      reason: 'auth_rejected',
    });
  });

  it.each([401, 403])('classifies HTTP %s as an invalid key', async (status) => {
    const http = new FakeHttp([new HttpError(status, `HTTP ${status}`)]);
    const result = await new GeminiProvider(
      { provider: 'gemini', apiKey: 'bad' },
      http,
    ).listModels();

    expect(result).toMatchObject({
      source: 'fallback',
      keyStatus: 'invalid',
      reason: 'auth_rejected',
    });
  });

  it.each([
    ['network failure', new TypeError('Failed to fetch')],
    ['rate limit', new HttpError(429, 'Too Many Requests')],
    ['provider outage', new HttpError(500, 'Internal Server Error')],
  ])('leaves key status unknown on %s', async (_label, error) => {
    const http = new FakeHttp([error]);
    const result = await new GeminiProvider(
      { provider: 'gemini', apiKey: 'not-checked' },
      http,
    ).listModels();

    expect(result).toMatchObject({
      source: 'fallback',
      keyStatus: 'unknown',
      reason: 'provider_unavailable',
    });
  });

  it('treats malformed 2xx data as authenticated with a fallback catalog', async () => {
    const http = new FakeHttp([{ unexpected: true }]);
    const result = await new GeminiProvider(
      { provider: 'gemini', apiKey: 'AIza-live' },
      http,
    ).listModels();

    expect(result).toEqual({
      models: FALLBACK_MODELS.gemini,
      source: 'fallback',
      keyStatus: 'valid',
      reason: 'malformed_catalog',
    });
  });

  it('uses the same trimmed credential for verification and completion', async () => {
    const http = new FakeHttp([GEMINI_RAW], {
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    });
    const provider = new GeminiProvider({ provider: 'gemini', apiKey: '  AIza-live  ' }, http);

    await provider.listModels();
    await provider.complete({ messages: [{ role: 'user', content: 'hello' }] });

    expect(http.getCalls[0]?.headers).toEqual({ 'x-goog-api-key': 'AIza-live' });
    expect(http.postCalls[0]?.url).toContain('?key=AIza-live');
    expect(http.postCalls[0]?.url).not.toContain('%20');
  });
});
