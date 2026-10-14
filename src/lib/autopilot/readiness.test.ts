import { describe, expect, it } from 'vitest';
import { readinessItems } from './readiness';

const ready = {
  modulesOn: true,
  hasKeywords: true,
  hasExpertise: true,
  llmRequired: false,
  hasLlmKey: false,
  linkedInTab: true,
  paused: false,
};

describe('readinessItems', () => {
  it('lists only real gaps and skips the LLM row when text generation is off', () => {
    const items = readinessItems({ ...ready, hasKeywords: false, linkedInTab: false });
    expect(items.find((item) => item.id === 'keywords')?.ok).toBe(false);
    expect(items.find((item) => item.id === 'linkedin')?.ok).toBe(false);
    expect(items.some((item) => item.id === 'llm')).toBe(false);
  });

  it('asks for a key when comments or content need one, and surfaces pause', () => {
    const items = readinessItems({ ...ready, llmRequired: true, paused: true });
    expect(items.find((item) => item.id === 'llm')?.ok).toBe(false);
    expect(items.find((item) => item.id === 'paused')?.ok).toBe(false);
  });
});
