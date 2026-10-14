import { describe, it, expect } from 'vitest';
import { engagementLimit, DEFAULT_LIKES_PER_DAY } from './engagementLimit';

const eng = (dailyLimit: number) => ({
  id: 'engagement',
  enabled: true,
  automationLevel: 'manual',
  available: true,
  dailyLimit,
});

describe('engagementLimit', () => {
  it('returns the engagement module dailyLimit', () => {
    expect(engagementLimit([eng(50)])).toBe(50);
  });

  it('falls back to the default when missing or non-positive', () => {
    expect(engagementLimit([])).toBe(DEFAULT_LIKES_PER_DAY);
    expect(engagementLimit([eng(0)])).toBe(DEFAULT_LIKES_PER_DAY);
    expect(engagementLimit(null)).toBe(DEFAULT_LIKES_PER_DAY);
  });

  it('survives chrome.storage serialising the array as an object', () => {
    expect(engagementLimit({ 0: eng(42) })).toBe(42);
  });
});
