import { describe, expect, it } from 'vitest';
import { isPausedUntil, tomorrowKey } from './runPause';

describe('run pause', () => {
  it('pauses until the stored local day and then lifts', () => {
    expect(isPausedUntil('2026-08-12', '2026-08-11')).toBe(true);
    expect(isPausedUntil('2026-08-12', '2026-08-12')).toBe(false);
    expect(isPausedUntil('nope', '2026-08-11')).toBe(false);
  });

  it('names tomorrow from the local calendar', () => {
    expect(tomorrowKey(new Date(2026, 7, 11, 23, 30))).toBe('2026-08-12');
  });
});
