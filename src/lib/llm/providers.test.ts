import { describe, it, expect } from 'vitest';
import { OpenRouterProvider } from './OpenRouterProvider';
import { GeminiProvider } from './GeminiProvider';
import type { HttpClient, HttpGet, LlmRequest } from './contracts';

/** Records the last call and returns a canned response. */
class FakeHttp implements HttpClient, HttpGet {
  calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  constructor(private readonly response: unknown) {}
  async postJson<T>(url: string, body: unknown, headers: Record<string, string>): Promise<T> {
    this.calls.push({ url, body, headers });
    return this.response as T;
  }
  async getJson<T>(): Promise<T> {
    throw new Error('not used');
  }
}

const req: LlmRequest = { messages: [{ role: 'user', content: 'hi' }] };

describe('OpenRouterProvider', () => {
  it('posts to the chat-completions endpoint with a Bearer key', async () => {
    const http = new FakeHttp({ choices: [{ message: { content: 'pong' } }] });
    const provider = new OpenRouterProvider({ provider: 'openrouter', apiKey: 'sk-123' }, http);

    const result = await provider.complete(req);

    expect(result).toEqual({ text: 'pong', model: provider.defaultModel, provider: 'openrouter' });
    expect(http.calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(http.calls[0].headers.Authorization).toBe('Bearer sk-123');
  });

  it('honours an explicit model override', async () => {
    const http = new FakeHttp({ choices: [{ message: { content: 'x' } }] });
    const provider = new OpenRouterProvider({ provider: 'openrouter', apiKey: 'k' }, http);
    const result = await provider.complete({ ...req, model: 'anthropic/claude-x' });
    expect(result.model).toBe('anthropic/claude-x');
  });
});

describe('GeminiProvider', () => {
  it('puts the API key in the query string and targets the configured model', async () => {
    const http = new FakeHttp({ candidates: [{ content: { parts: [{ text: 'pong' }] } }] });
    const provider = new GeminiProvider(
      { provider: 'gemini', apiKey: 'AIza-1', model: 'gemini-2.5-flash' },
      http,
    );

    const result = await provider.complete(req);

    expect(result).toEqual({ text: 'pong', model: 'gemini-2.5-flash', provider: 'gemini' });
    expect(http.calls[0].url).toContain('/models/gemini-2.5-flash:generateContent');
    expect(http.calls[0].url).toContain('key=AIza-1');
    // Key must never leak into headers.
    expect(JSON.stringify(http.calls[0].headers)).not.toContain('AIza-1');
  });
});
