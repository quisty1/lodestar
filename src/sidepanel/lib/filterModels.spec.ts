import { describe, it, expect } from 'vitest';
import { filterModels } from './filterModels';
import type { LlmModel } from '@lib/llm/models';

describe('filterModels', () => {
  it('matches by id or label, case-insensitive', () => {
    const models: LlmModel[] = [
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini' },
    ];
    expect(filterModels(models, 'GEMINI').map((m) => m.id)).toEqual(['google/gemini-2.5-flash']);
    expect(filterModels(models, 'gpt').map((m) => m.id)).toEqual(['openai/gpt-4o']);
  });

  it('returns the whole list (capped) for an empty query', () => {
    const models = Array.from({ length: 25 }, (_, i) => ({ id: `m${i}`, label: `M${i}` }));
    expect(filterModels(models, '   ')).toHaveLength(10);
  });

  it('caps matches at the limit', () => {
    const models = Array.from({ length: 25 }, (_, i) => ({ id: `m${i}`, label: `M${i}` }));
    expect(filterModels(models, 'm1')).toHaveLength(10); // m1, m10..m19 = 11 → capped
    expect(filterModels(models, 'm', 3)).toHaveLength(3);
  });

  it('returns [] when nothing matches', () => {
    expect(filterModels([{ id: 'a', label: 'A' }], 'zzz')).toEqual([]);
  });
});
