import { describe, expect, it } from 'vitest';
import { recordEffectForPeriod } from './EffectCounter';

interface Counter {
  used: number;
  effectIds?: string[];
}

describe('recordEffectForPeriod', () => {
  it.each([
    ['numeric string', '4'],
    ['NaN', Number.NaN],
    ['negative', -7],
  ])('normalizes malformed %s used before adding', (_label, used) => {
    const current = { used, effectIds: ['old', '', 'old'] } as unknown as Counter;

    expect(
      recordEffectForPeriod(current, '2026-08-11', '2026-08-11', () => ({ used: 0 }), 'next'),
    ).toEqual({
      used: 1,
      effectIds: ['old', 'next'],
    });
  });

  it.each(['not-a-period', '9999-W99', '9999-W53', '2026-99-99'])(
    'does not let malformed period %s freeze a counter',
    (period) => {
      const current = { used: 9, effectIds: ['future'] };

      expect(
        recordEffectForPeriod(current, period, '2026-W33', () => ({ used: 0 }), 'next'),
      ).toEqual({
        used: 1,
        effectIds: ['next'],
      });
    },
  );

  it('keeps a valid newer period but removes poisoned values', () => {
    const current = { used: -3, effectIds: ['new', '', 'new'] };

    expect(
      recordEffectForPeriod(current, '2026-W34', '2026-W33', () => ({ used: 0 }), 'old'),
    ).toEqual({
      used: 0,
      effectIds: ['new'],
    });
  });

  it('replaces a malformed non-array effectIds value before deduping or appending', () => {
    const current = { used: 1, effectIds: 'effect-1' } as unknown as Counter;

    expect(
      recordEffectForPeriod(current, '2026-08-11', '2026-08-11', () => ({ used: 0 }), 'effect'),
    ).toEqual({
      used: 2,
      effectIds: ['effect'],
    });
  });
});
