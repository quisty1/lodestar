import { describe, it, expect } from 'vitest';
import {
  loadSettings,
  DEFAULT_SETTINGS,
  parseCsv,
  applyTargetForm,
  applyExpertiseForm,
} from './settings';
import type { KeyValueStore } from '../ports';
import type { ModuleState } from '../types';

function memStore(seed: Record<string, unknown> = {}): KeyValueStore {
  const m = new Map<string, unknown>(Object.entries(seed));
  return {
    async get<T>(k: string) {
      return m.has(k) ? (m.get(k) as T) : null;
    },
    async set<T>(k: string, v: T) {
      m.set(k, v);
    },
  };
}

const modules: ModuleState[] = [
  {
    id: 'engagement',
    enabled: true,
    automationLevel: 'full_auto',
    available: true,
    dailyLimit: 35,
  },
];

describe('loadSettings', () => {
  it('defaults to manual when nothing is stored', async () => {
    const s = await loadSettings(memStore());
    expect(s.config.level).toBe('manual');
  });

  it('parses comma-separated input, trimming and dropping blanks', () => {
    expect(parseCsv('Vue, TypeScript ,http,, ')).toEqual(['Vue', 'TypeScript', 'http']);
    expect(parseCsv('   ')).toEqual([]);
    expect(parseCsv('')).toEqual([]);
  });

  it('applyTargetForm updates stack/roles/threshold, preserving the rest', () => {
    const next = applyTargetForm(DEFAULT_SETTINGS, {
      stack: 'Vue, http',
      roles: 'recruiter',
      threshold: 0.5,
    });
    expect(next.target.stack).toEqual(['Vue', 'http']);
    expect(next.target.targetRoles).toEqual(['recruiter']);
    expect(next.relevanceThreshold).toBe(0.5);
    // untouched fields preserved
    expect(next.config).toEqual(DEFAULT_SETTINGS.config);
    expect(next.target.geos).toEqual(DEFAULT_SETTINGS.target.geos);
  });

  it('applyTargetForm clamps the threshold into [0,1]', () => {
    expect(
      applyTargetForm(DEFAULT_SETTINGS, { stack: '', roles: '', threshold: 5 }).relevanceThreshold,
    ).toBe(1);
    expect(
      applyTargetForm(DEFAULT_SETTINGS, { stack: '', roles: '', threshold: -2 }).relevanceThreshold,
    ).toBe(0);
  });

  it("drives config.level from the engagement module's automationLevel (SSOT)", async () => {
    const s = await loadSettings(memStore({ 'modules:state': modules }));
    expect(s.config.level).toBe('full_auto');
  });

  it('tolerates a non-array modules:state without crashing', async () => {
    const s = await loadSettings(memStore({ 'modules:state': { corrupt: true } }));
    expect(s.config.level).toBe('manual');
  });

  it('reads the level from an array-like object (chrome.storage serialised a reactive array)', async () => {
    // chrome.storage stores a Vue reactive array as {0:..,1:..} — must still be read.
    const arrayLike = {
      0: { id: 'engagement', automationLevel: 'full_auto', available: true, enabled: true },
      1: { id: 'smart_connect', automationLevel: 'manual', available: true, enabled: true },
    };
    const s = await loadSettings(memStore({ 'modules:state': arrayLike }));
    expect(s.config.level).toBe('full_auto');
  });

  it('keeps the rest of the stored settings while overriding the level', async () => {
    const stored = { ...DEFAULT_SETTINGS, relevanceThreshold: 0.5 };
    const s = await loadSettings(
      memStore({ 'engagement:settings': stored, 'modules:state': modules }),
    );
    expect(s.relevanceThreshold).toBe(0.5);
    expect(s.config.level).toBe('full_auto');
  });
});

describe('applyExpertiseForm', () => {
  it('updates expertise without clobbering target or config', () => {
    const current = {
      ...DEFAULT_SETTINGS,
      target: { ...DEFAULT_SETTINGS.target, stack: ['Vue', 'TS'], watchlistCompanies: ['Wise'] },
    };
    const next = applyExpertiseForm(current, {
      headline: 'Frontend TechLead, 11y Vue/TS',
      stack: 'Vue, TypeScript, Nuxt',
      bio: 'Mentor & TeamLead',
    });
    expect(next.expertise).toEqual({
      headline: 'Frontend TechLead, 11y Vue/TS',
      stack: ['Vue', 'TypeScript', 'Nuxt'],
      bio: 'Mentor & TeamLead',
    });
    // critical: the rest of the blob is preserved
    expect(next.target).toEqual(current.target);
    expect(next.config).toEqual(current.config);
    expect(next.relevanceThreshold).toEqual(current.relevanceThreshold);
  });

  it('omits bio when empty', () => {
    const next = applyExpertiseForm(DEFAULT_SETTINGS, { headline: 'X', stack: 'Vue', bio: '   ' });
    expect(next.expertise.bio).toBeUndefined();
  });
});
