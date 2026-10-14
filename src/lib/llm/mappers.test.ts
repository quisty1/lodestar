import { describe, it, expect } from 'vitest';
import {
  toOpenRouterBody,
  fromOpenRouterResponse,
  toGeminiBody,
  fromGeminiResponse,
} from './mappers';
import { LlmResponseError, type LlmRequest } from './contracts';

const req: LlmRequest = {
  messages: [
    { role: 'system', content: 'You are Lodestar.' },
    { role: 'user', content: 'Draft a post.' },
  ],
  model: 'x-model',
  temperature: 0.7,
  maxTokens: 256,
};

describe('OpenRouter mappers', () => {
  it('builds an OpenAI-style chat body, messages passed through verbatim', () => {
    const body = toOpenRouterBody(req, 'fallback-model');
    expect(body).toEqual({
      model: 'x-model',
      messages: [
        { role: 'system', content: 'You are Lodestar.' },
        { role: 'user', content: 'Draft a post.' },
      ],
      temperature: 0.7,
      max_tokens: 256,
    });
  });

  it('falls back to the default model when none is given', () => {
    const body = toOpenRouterBody({ messages: req.messages }, 'fallback-model');
    expect(body.model).toBe('fallback-model');
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });

  it('extracts the assistant message content', () => {
    const text = fromOpenRouterResponse({
      choices: [{ message: { role: 'assistant', content: 'Hello world' } }],
    });
    expect(text).toBe('Hello world');
  });

  it('throws a typed error on an empty/garbage response', () => {
    expect(() => fromOpenRouterResponse({ choices: [] })).toThrow(LlmResponseError);
    expect(() => fromOpenRouterResponse({})).toThrow(LlmResponseError);
  });
});

describe('Gemini mappers', () => {
  it('routes system messages to systemInstruction and maps assistant→model', () => {
    const body = toGeminiBody(req);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'You are Lodestar.' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Draft a post.' }] }]);
    expect(body.generationConfig).toEqual({ temperature: 0.7, maxOutputTokens: 256 });
  });

  it('maps an assistant turn to the "model" role', () => {
    const body = toGeminiBody({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hey' },
      ],
    });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hey' }] },
    ]);
    expect(body.systemInstruction).toBeUndefined();
    expect(body.generationConfig).toBeUndefined();
  });

  it('extracts text from the first candidate, joining multiple parts', () => {
    const text = fromGeminiResponse({
      candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'world' }] } }],
    });
    expect(text).toBe('Hello world');
  });

  it('throws a typed error when blocked or empty', () => {
    expect(() => fromGeminiResponse({ candidates: [] })).toThrow(LlmResponseError);
    expect(() => fromGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(
      LlmResponseError,
    );
  });
});
