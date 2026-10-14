import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useContentSettings } from './useContentSettings';
import { DEFAULT_POST_PROMPT } from '@lib/content/settings';

const mem = new Map<string, unknown>();
beforeEach(() => {
  mem.clear();
  (globalThis as any).chrome = {
    runtime: { id: 'x' },
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: mem.get(k) })),
        set: vi.fn(async (o: Record<string, unknown>) => {
          for (const k in o) mem.set(k, o[k]);
        }),
      },
    },
  };
});

describe('useContentSettings', () => {
  it('loads the default prompt, saves a custom one', async () => {
    const s = useContentSettings();
    await s.load();
    expect(s.prompt.value).toBe(DEFAULT_POST_PROMPT);
    s.prompt.value = 'Custom voice.';
    await s.save();
    expect((mem.get('content:settings') as any).postPrompt).toBe('Custom voice.');
  });
});
