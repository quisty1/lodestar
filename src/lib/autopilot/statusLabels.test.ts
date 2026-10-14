import { describe, it, expect } from 'vitest';
import { pauseLabel, breakLabel, breakCountdownLabel, SCANNING, LIKING } from './statusLabels';

describe('statusLabels', () => {
  it('formats the anti-ban pause in seconds', () => {
    expect(pauseLabel(22000)).toBe('Пауза 22с');
    expect(pauseLabel(8000)).toBe('Пауза 8с');
  });

  it('rounds sub-second pauses up to at least 1с', () => {
    expect(pauseLabel(400)).toBe('Пауза 1с');
  });

  it('formats the human break in minutes', () => {
    expect(breakLabel(120000)).toBe('Перерыв 2 мин ☕');
    expect(breakLabel(60000)).toBe('Перерыв 1 мин ☕');
    expect(breakLabel(150000)).toBe('Перерыв 3 мин ☕'); // 2.5 → 3
  });

  it('formats the live break countdown as m:ss', () => {
    expect(breakCountdownLabel(129000)).toBe('Перерыв 2:09 ☕');
    expect(breakCountdownLabel(60000)).toBe('Перерыв 1:00 ☕');
    expect(breakCountdownLabel(5000)).toBe('Перерыв 0:05 ☕');
  });

  it('exposes phase constants', () => {
    expect(SCANNING).toMatch(/Сканирую/);
    expect(LIKING).toMatch(/лайк/i);
  });
});
