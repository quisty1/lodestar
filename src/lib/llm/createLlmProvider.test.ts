import { describe, it, expect } from 'vitest';
import { createLlmProvider } from './createLlmProvider';
import type { HttpClient, HttpGet } from './contracts';

const http: HttpClient & HttpGet = {
  postJson: async <T>() => ({}) as T,
  getJson: async <T>() => ({}) as T,
};

describe('createLlmProvider', () => {
  it('builds an OpenRouter provider', () => {
    const p = createLlmProvider({ provider: 'openrouter', apiKey: 'k' }, http);
    expect(p.id).toBe('openrouter');
  });

  it('builds a Gemini provider', () => {
    const p = createLlmProvider({ provider: 'gemini', apiKey: 'k' }, http);
    expect(p.id).toBe('gemini');
  });

  it('throws on an unknown provider id', () => {
    // @ts-expect-error — exercising the runtime guard for an unsupported id
    expect(() => createLlmProvider({ provider: 'mistral', apiKey: 'k' }, http)).toThrow(
      /unsupported llm provider/i,
    );
  });
});
