import type { LlmModel } from '@lib/llm/models';

/** Search a model catalog by id/label and cap the result — OpenRouter returns hundreds. */
export function filterModels(models: LlmModel[], query: string, limit = 10): LlmModel[] {
  const q = query.trim().toLowerCase();
  const matched = q
    ? models.filter(
        (m) => m.id.toLowerCase().includes(q) || (m.label ?? '').toLowerCase().includes(q),
      )
    : models;
  return matched.slice(0, limit);
}
