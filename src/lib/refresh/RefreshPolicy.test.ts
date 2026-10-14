import { describe, it, expect } from 'vitest';
import { RefreshPolicy } from './RefreshPolicy';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-06-23T12:00:00.000Z');

describe('RefreshPolicy', () => {
  const policy = new RefreshPolicy(24 * HOUR);

  it('is due when there is no prior refresh', () => {
    expect(policy.isDue(null, now)).toBe(true);
  });

  it('is due when the stored timestamp is unparseable', () => {
    expect(policy.isDue('not-a-date', now)).toBe(true);
  });

  it('is due when the interval has fully elapsed', () => {
    const last = new Date(now.getTime() - 25 * HOUR).toISOString();
    expect(policy.isDue(last, now)).toBe(true);
  });

  it('is due exactly at the interval boundary', () => {
    const last = new Date(now.getTime() - 24 * HOUR).toISOString();
    expect(policy.isDue(last, now)).toBe(true);
  });

  it('is NOT due when within the interval', () => {
    const last = new Date(now.getTime() - 1 * HOUR).toISOString();
    expect(policy.isDue(last, now)).toBe(false);
  });
});
