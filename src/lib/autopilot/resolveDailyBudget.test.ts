import { describe, it, expect } from 'vitest';
import { resolveDailyBudget, type AutopilotDay } from './resolveDailyBudget';

describe('resolveDailyBudget', () => {
  it('starts a fresh day when there is no prior state', () => {
    expect(resolveDailyBudget(null, '2026-06-24', 40)).toEqual({
      day: '2026-06-24',
      ceiling: 40,
      used: 0,
    });
  });

  it('carries over the same-day ceiling AND used (re-run does not re-grant)', () => {
    const prev: AutopilotDay = { day: '2026-06-24', ceiling: 40, used: 25 };
    // a fresh ceiling is offered but ignored same-day
    expect(resolveDailyBudget(prev, '2026-06-24', 50)).toEqual({
      day: '2026-06-24',
      ceiling: 40,
      used: 25,
    });
  });

  it('resets on a new day with the fresh ceiling', () => {
    const prev: AutopilotDay = { day: '2026-06-24', ceiling: 40, used: 40 };
    expect(resolveDailyBudget(prev, '2026-06-25', 33)).toEqual({
      day: '2026-06-25',
      ceiling: 33,
      used: 0,
    });
  });
});
