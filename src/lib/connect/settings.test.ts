import { describe, it, expect } from 'vitest';
import {
  defaultConnectKeywords,
  loadConnectSettings,
  saveConnectSettings,
  ensureSearchKeywords,
  CONNECT_SETTINGS_KEY,
} from './settings';
import { SETTINGS_KEY } from '../engagement/settings';

function fakeStore(initial: Record<string, unknown> = {}) {
  const m = new Map<string, unknown>(Object.entries(initial));
  return {
    get: async <T>(k: string) => (m.get(k) as T) ?? null,
    set: async (k: string, v: unknown) => void m.set(k, v),
    map: m,
  };
}

const extras = {
  excludeIndia: false,
  excludeKeywords: [] as string[],
  pymkMode: 'fill' as const,
  notesPerMonth: 0,
};

describe('connect settings', () => {
  it('defaults keywords to "<first stack> recruiter", or "recruiter" when no stack', () => {
    expect(defaultConnectKeywords({ headline: '', stack: ['React', 'Vue'] })).toBe(
      'React recruiter',
    );
    expect(defaultConnectKeywords({ headline: '', stack: [] })).toBe('recruiter');
  });

  it('loads stored keywords; empty store → empty keywords + default region US', async () => {
    const empty = fakeStore();
    expect(await loadConnectSettings(empty)).toEqual({
      searchKeywords: '',
      targetRegions: ['US'],
      ...extras,
    });
    const s = fakeStore({
      [CONNECT_SETTINGS_KEY]: { searchKeywords: 'devops recruiter' },
    });
    expect(await loadConnectSettings(s)).toEqual({
      searchKeywords: 'devops recruiter',
      targetRegions: ['US'],
      ...extras,
    });
  });

  it('round-trips keywords + countries via save', async () => {
    const s = fakeStore();
    await saveConnectSettings(s, {
      searchKeywords: 'qa hiring',
      targetRegions: ['DE', 'RS'],
      ...extras,
    });
    expect(await loadConnectSettings(s)).toEqual({
      searchKeywords: 'qa hiring',
      targetRegions: ['DE', 'RS'],
      ...extras,
    });
  });

  it('expands legacy Europe and Asia bundles when loading', async () => {
    const s = fakeStore({
      [CONNECT_SETTINGS_KEY]: {
        searchKeywords: 'qa hiring',
        targetRegions: ['Europe', 'Asia'],
      },
    });
    expect((await loadConnectSettings(s)).targetRegions).toEqual(['DE', 'GB', 'IN', 'SG']);
  });

  it('recovers targetRegions saved as an array-like object (chrome.storage gotcha)', async () => {
    const s = fakeStore({
      [CONNECT_SETTINGS_KEY]: {
        searchKeywords: 'x',
        targetRegions: { 0: 'US', 1: 'Europe' },
      },
    });
    expect((await loadConnectSettings(s)).targetRegions).toEqual(['US', 'DE', 'GB']);
  });
});

// ensureSearchKeywords backs the Modules card: it returns the keywords to display AND persists
// the expertise prefill when nothing is saved, so the field never shows a value a run won't use.
// A run itself reads persisted storage only — this is what makes "shown in the card" == "saved".
describe('ensureSearchKeywords', () => {
  it('returns the persisted keywords without overwriting them', async () => {
    const s = fakeStore({
      [CONNECT_SETTINGS_KEY]: {
        searchKeywords: 'devops recruiter',
        targetRegions: ['Europe'],
      },
    });
    expect(await ensureSearchKeywords(s)).toBe('devops recruiter');
    // untouched — a saved value is authoritative
    expect(s.map.get(CONNECT_SETTINGS_KEY)).toEqual({
      searchKeywords: 'devops recruiter',
      targetRegions: ['Europe'],
    });
  });

  it('persists the expertise prefill when nothing is saved (so a run later reads it)', async () => {
    const s = fakeStore({
      [SETTINGS_KEY]: { expertise: { headline: '', stack: ['React'] } },
    });
    expect(await ensureSearchKeywords(s)).toBe('React recruiter');
    // crosses the panel→storage boundary the run depends on: the prefill is now durable, not just shown
    expect(await loadConnectSettings(s)).toEqual({
      searchKeywords: 'React recruiter',
      targetRegions: ['US'],
      ...extras,
    });
  });

  it('persists a generic "recruiter" when neither keywords nor an expertise stack exist', async () => {
    const s = fakeStore();
    expect(await ensureSearchKeywords(s)).toBe('recruiter');
    expect((await loadConnectSettings(s)).searchKeywords).toBe('recruiter');
  });

  it('preserves saved regions when persisting the prefill', async () => {
    const s = fakeStore({
      [CONNECT_SETTINGS_KEY]: {
        searchKeywords: '',
        targetRegions: ['Europe', 'Asia'],
      },
      [SETTINGS_KEY]: { expertise: { headline: '', stack: ['Go'] } },
    });
    expect(await ensureSearchKeywords(s)).toBe('Go recruiter');
    expect(await loadConnectSettings(s)).toEqual({
      searchKeywords: 'Go recruiter',
      targetRegions: ['DE', 'GB', 'IN', 'SG'],
      ...extras,
    });
  });
});
