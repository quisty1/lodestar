import { describe, it, expect } from 'vitest';
import { loadContentSettings, saveContentSettings, DEFAULT_POST_PROMPT } from './settings';
import type { KeyValueStore } from '@lib/ports';

function memStore(initial?: Record<string, unknown>): KeyValueStore {
  const m = new Map<string, unknown>(Object.entries(initial ?? {}));
  return {
    async get<T>(k: string) {
      return m.has(k) ? (m.get(k) as T) : null;
    },
    async set<T>(k: string, v: T) {
      m.set(k, v);
    },
  };
}

describe('content settings', () => {
  it('returns the default prompt and comments off by default when unset', async () => {
    const s = await loadContentSettings(memStore());
    expect(s.postPrompt).toBe(DEFAULT_POST_PROMPT);
    expect(s.commentsEnabled).toBe(false);
    expect(s.commentsPerDay).toBe(5);
    expect(s.commentTone).toBe('expert');
    expect(s.postsPerWeek).toBe(3);
    expect(s.contentLanguage).toBe('en');
  });

  it('round-trips custom prompt + comment config', async () => {
    const store = memStore();
    await saveContentSettings(store, {
      postPrompt: 'Write like a pirate.',
      commentsEnabled: true,
      commentsPerDay: 3,
      commentTone: 'friendly',
      postsPerWeek: 5,
      contentLanguage: 'ru',
      publishDays: [1, 3, 5],
      voiceSamples: ['A past post.'],
    });
    const s = await loadContentSettings(store);
    expect(s.postPrompt).toBe('Write like a pirate.');
    expect(s.commentsEnabled).toBe(true);
    expect(s.commentsPerDay).toBe(3);
    expect(s.commentTone).toBe('friendly');
    expect(s.postsPerWeek).toBe(5);
    expect(s.contentLanguage).toBe('ru');
    expect(s.publishDays).toEqual([1, 3, 5]);
    expect(s.voiceSamples).toEqual(['A past post.']);
  });

  it('defaults publishDays to Mon/Wed/Fri when unset', async () => {
    expect((await loadContentSettings(memStore())).publishDays).toEqual([1, 3, 5]);
  });

  it('sanitises persisted publishDays (array-as-object, out-of-range, dupes)', async () => {
    const store = memStore({ 'content:settings': { publishDays: { 0: 1, 1: 1, 2: 9, 3: -2 } } });
    expect((await loadContentSettings(store)).publishDays).toEqual([1]);
  });
});
