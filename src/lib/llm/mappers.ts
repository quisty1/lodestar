// Pure request/response mappers for each provider's wire format.
// No I/O here — these are fully unit-tested (SRP: translation only).

import { LlmResponseError, type LlmRequest } from './contracts';

// ──────────────────────────── OpenRouter ────────────────────────────
// OpenAI-compatible Chat Completions API.

export interface OpenRouterBody {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
}

export function toOpenRouterBody(req: LlmRequest, defaultModel: string): OpenRouterBody {
  return {
    model: req.model ?? defaultModel,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(req.temperature != null ? { temperature: req.temperature } : {}),
    ...(req.maxTokens != null ? { max_tokens: req.maxTokens } : {}),
  };
}

export function fromOpenRouterResponse(res: unknown): string {
  const choice = (res as { choices?: { message?: { content?: string } }[] })?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new LlmResponseError('OpenRouter returned no message content', 'openrouter');
  }
  return content;
}

// ──────────────────────────── Gemini ────────────────────────────
// Google Generative Language API (generateContent).
// Differences: system prompt → systemInstruction; assistant role → "model".

export interface GeminiPart {
  text: string;
}
export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}
export interface GeminiBody {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: { temperature?: number; maxOutputTokens?: number };
}

export function toGeminiBody(req: LlmRequest): GeminiBody {
  const systemText = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n')
    .trim();

  const contents: GeminiContent[] = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const generationConfig: GeminiBody['generationConfig'] = {
    ...(req.temperature != null ? { temperature: req.temperature } : {}),
    ...(req.maxTokens != null ? { maxOutputTokens: req.maxTokens } : {}),
  };

  return {
    contents,
    ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  };
}

export function fromGeminiResponse(res: unknown): string {
  const r = res as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  if (r?.promptFeedback?.blockReason) {
    throw new LlmResponseError(`Gemini blocked: ${r.promptFeedback.blockReason}`, 'gemini');
  }
  const parts = r?.candidates?.[0]?.content?.parts;
  const text = parts
    ?.map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) {
    throw new LlmResponseError('Gemini returned no candidate text', 'gemini');
  }
  return text;
}
