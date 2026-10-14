import { describe, it, expect } from 'vitest';
import {
  ideasPerDayLimit,
  rolloverIdeaDay,
  recordIdeaDay,
  remainingIdeas,
  DEFAULT_IDEAS_PER_DAY,
} from './IdeaDayBudget';
import type { ModuleState } from '../types';

const content = (dailyLimit: number): ModuleState => ({
  id: 'content',
  enabled: true,
  automationLevel: 'manual',
  available: true,
  dailyLimit,
});

describe('ideasPerDayLimit', () => {
  it('reads the content module limit', () => {
    expect(ideasPerDayLimit([content(8)])).toBe(8);
  });
  it('falls back to the default when missing/zero/array-as-object', () => {
    expect(ideasPerDayLimit([])).toBe(DEFAULT_IDEAS_PER_DAY);
    expect(ideasPerDayLimit([content(0)])).toBe(DEFAULT_IDEAS_PER_DAY);
    expect(ideasPerDayLimit({ 0: content(6) })).toBe(6);
  });
});

describe('idea day budget', () => {
  it('carries over the same day, resets on a new day', () => {
    const a = recordIdeaDay(rolloverIdeaDay(null, '2026-06-25'), 3);
    expect(rolloverIdeaDay(a, '2026-06-25')).toEqual({ day: '2026-06-25', used: 3 });
    expect(rolloverIdeaDay(a, '2026-06-26')).toEqual({ day: '2026-06-26', used: 0 });
  });
  it('remaining clamps at 0', () => {
    const s = recordIdeaDay(rolloverIdeaDay(null, 'd'), 6);
    expect(remainingIdeas(s, 5)).toBe(0);
    expect(remainingIdeas({ day: 'd', used: 2 }, 5)).toBe(3);
  });
});
