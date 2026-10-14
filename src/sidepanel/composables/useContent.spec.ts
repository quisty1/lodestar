import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useContent } from './useContent';

const mem = new Map<string, unknown>();
beforeEach(() => {
  mem.clear();
  (globalThis as any).chrome = {
    runtime: {
      id: 'x',
      sendMessage: vi.fn().mockResolvedValue({ ideas: [{ topic: 'T', angle: 'A' }] }),
    },
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

describe('useContent', () => {
  it('generates ideas via the SW and loads them from the bank', async () => {
    mem.set('ideas:bank', [{ topic: 'T', angle: 'A' }]);
    const c = useContent();
    await c.generateIdeas();
    expect(c.ideas.value).toEqual([{ topic: 'T', angle: 'A' }]);
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'GENERATE_IDEAS' }),
    );
  });

  it('removes an idea from the bank', async () => {
    mem.set('ideas:bank', [
      { topic: 'T', angle: 'A' },
      { topic: 'U', angle: 'B' },
    ]);
    const c = useContent();
    await c.loadIdeas();
    await c.removeIdea({ topic: 'T', angle: 'A' });
    expect(c.ideas.value).toEqual([{ topic: 'U', angle: 'B' }]);
  });
});
