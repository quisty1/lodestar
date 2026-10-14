import { describe, it, expect } from 'vitest';
import { sparklinePoints, deltaArrow, deltaLabel, pluralDays, spanLabel } from './ssiTrendView';

describe('sparklinePoints', () => {
  it('returns empty for no values or bad dimensions', () => {
    expect(sparklinePoints([], 100, 30)).toBe('');
    expect(sparklinePoints([1, 2], 0, 30)).toBe('');
    expect(sparklinePoints([1, 2], 100, 0)).toBe('');
  });

  it('renders a single value as a flat full-width line', () => {
    // value 25 of max 25 → top (y=0), spanning 0..100
    expect(sparklinePoints([25], 100, 30, 25)).toBe('0,0 100,0');
  });

  it('spreads points across width and inverts Y', () => {
    // [0,25] over width 100, height 30, max 25:
    // i0 → x0, v0 → y=30 (bottom); i1 → x100, v25 → y=0 (top)
    expect(sparklinePoints([0, 25], 100, 30, 25)).toBe('0,30 100,0');
  });

  it('clamps values outside [0,max]', () => {
    expect(sparklinePoints([-5, 50], 100, 30, 25)).toBe('0,30 100,0');
  });
});

describe('deltaArrow', () => {
  it('maps sign to a glyph', () => {
    expect(deltaArrow(2.3)).toBe('▲');
    expect(deltaArrow(-1)).toBe('▼');
    expect(deltaArrow(0)).toBe('■');
  });
});

describe('deltaLabel', () => {
  it('formats signed values without noisy decimals', () => {
    expect(deltaLabel(4.8)).toBe('+4.8');
    expect(deltaLabel(3)).toBe('+3');
    expect(deltaLabel(-2)).toBe('−2');
    expect(deltaLabel(0)).toBe('0');
    expect(deltaLabel(0.04)).toBe('0'); // rounds to 0
  });
});

describe('pluralDays / spanLabel', () => {
  it('picks the correct Russian plural, including the 11-14 and 21-24 traps', () => {
    expect(pluralDays(1)).toBe('день');
    expect(pluralDays(2)).toBe('дня');
    expect(pluralDays(4)).toBe('дня');
    expect(pluralDays(5)).toBe('дней');
    expect(pluralDays(11)).toBe('дней'); // trap: 11 is not "день"
    expect(pluralDays(14)).toBe('дней');
    expect(pluralDays(21)).toBe('день'); // trap: prior "d<5" rule said "дней"
    expect(pluralDays(22)).toBe('дня');
    expect(pluralDays(90)).toBe('дней');
  });

  it('labels the span honestly', () => {
    expect(spanLabel(0)).toBe('сегодня');
    expect(spanLabel(1)).toBe('за 1 день');
    expect(spanLabel(22)).toBe('за 22 дня');
    expect(spanLabel(90)).toBe('за 90 дней');
  });
});
