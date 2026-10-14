import { describe, it, expect } from 'vitest';
import { BurstGuard } from './BurstGuard';

const MIN = 60_000;

describe('BurstGuard', () => {
  const guard = new BurstGuard({ maxActions: 5, windowMs: 3 * MIN });
  const now = 10 * MIN;

  it('allows when under the limit in the window', () => {
    const ts = [now - 1000, now - 2000]; // 2 in window
    expect(guard.check(ts, now)).toEqual({ ok: true, waitMs: 0 });
  });

  it('blocks at the limit and reports how long to wait', () => {
    // 5 actions in the window, oldest at now - 2min → wait until it exits (1min left)
    const ts = [now - 2 * MIN, now - 90_000, now - 60_000, now - 30_000, now - 1000];
    const r = guard.check(ts, now);
    expect(r.ok).toBe(false);
    expect(r.waitMs).toBe(MIN); // oldest leaves the 3-min window in 1 min
  });

  it('ignores timestamps outside the window', () => {
    const ts = [now - 10 * MIN, now - 9 * MIN, now - 8 * MIN, now - 7 * MIN, now - 4 * MIN];
    expect(guard.check(ts, now)).toEqual({ ok: true, waitMs: 0 }); // all older than 3min
  });
});
