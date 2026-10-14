import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useExpertiseSettings } from './useExpertiseSettings';

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

describe('useExpertiseSettings', () => {
  it('saves expertise and preserves the rest of engagement settings', async () => {
    mem.set('engagement:settings', {
      config: { level: 'manual' },
      target: { stack: ['Vue'] },
      expertise: { headline: '', stack: [] },
      relevanceThreshold: 0.3,
    });
    const s = useExpertiseSettings();
    await s.load();
    s.form.value = { headline: 'TechLead', stack: 'Vue, TS', bio: 'mentor' };
    await s.save();
    expect((mem.get('engagement:settings') as any).expertise).toEqual({
      headline: 'TechLead',
      stack: ['Vue', 'TS'],
      bio: 'mentor',
    });
    expect((mem.get('engagement:settings') as any).target).toEqual({ stack: ['Vue'] });
  });
});
