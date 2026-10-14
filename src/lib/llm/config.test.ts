import { describe, it, expect } from 'vitest';
import { loadLlmConfig, saveLlmConfig, DEFAULT_LLM_CONFIG, hasLlmKey } from './config';
import type { KeyValueStore } from '@lib/ports';

function memStore(): KeyValueStore {
  const m = new Map<string, unknown>();
  return {
    async get<T>(k: string) {
      return m.has(k) ? (m.get(k) as T) : null;
    },
    async set<T>(k: string, v: T) {
      m.set(k, v);
    },
  };
}

describe('llm config', () => {
  it('returns the default when nothing is stored', async () => {
    expect(await loadLlmConfig(memStore())).toEqual(DEFAULT_LLM_CONFIG);
  });

  it('round-trips a saved config', async () => {
    const store = memStore();
    await saveLlmConfig(store, { provider: 'gemini', apiKey: 'AIza-x', model: 'gemini-2.5-flash' });
    expect(await loadLlmConfig(store)).toEqual({
      provider: 'gemini',
      apiKey: 'AIza-x',
      model: 'gemini-2.5-flash',
    });
  });

  it('hasLlmKey is false for an empty key, true otherwise', () => {
    expect(hasLlmKey({ provider: 'openrouter', apiKey: '' })).toBe(false);
    expect(hasLlmKey({ provider: 'openrouter', apiKey: '   ' })).toBe(false);
    expect(hasLlmKey({ provider: 'openrouter', apiKey: 'sk-1' })).toBe(true);
  });
});
