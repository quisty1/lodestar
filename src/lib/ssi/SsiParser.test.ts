import { describe, it, expect } from 'vitest';
import { SsiParser } from './SsiParser';
import { createSsiParser } from './createSsiParser';
import type { Clock, SsiParseStrategy } from '../ports';
import type { SsiSnapshot } from '../types';

const fixedClock: Clock = { now: () => new Date('2026-06-23T10:00:00.000Z') };

function strategy(name: string, result: Omit<SsiSnapshot, 'capturedAt'> | null): SsiParseStrategy {
  return { name, parse: () => result };
}

const sample: Omit<SsiSnapshot, 'capturedAt'> = {
  total: 71,
  pillars: [
    { key: 'brand', label: 'Бренд', score: 18 },
    { key: 'people', label: 'Люди', score: 20 },
    { key: 'insights', label: 'Инсайты', score: 15 },
    { key: 'relationships', label: 'Связи', score: 18 },
  ],
  industryRank: 'Top 4%',
  networkRank: 'Top 1%',
};

describe('SsiParser', () => {
  const root = document.createElement('div');

  it('throws when constructed with no strategies', () => {
    expect(() => new SsiParser([], fixedClock)).toThrow();
  });

  it('returns the first successful strategy result', () => {
    const parser = new SsiParser([strategy('primary', sample)], fixedClock);
    const snap = parser.parse(root);
    expect(snap?.total).toBe(71);
    expect(snap?.pillars).toHaveLength(4);
  });

  it('falls through to the next strategy when the first returns null', () => {
    const parser = new SsiParser(
      [strategy('primary', null), strategy('fallback', sample)],
      fixedClock,
    );
    expect(parser.parse(root)?.industryRank).toBe('Top 4%');
  });

  it('stamps capturedAt from the injected clock', () => {
    const parser = new SsiParser([strategy('primary', sample)], fixedClock);
    expect(parser.parse(root)?.capturedAt).toBe('2026-06-23T10:00:00.000Z');
  });

  it('returns null when every strategy fails', () => {
    const parser = new SsiParser([strategy('a', null), strategy('b', null)], fixedClock);
    expect(parser.parse(root)).toBeNull();
  });

  it('falls through a partial structural match to the complete localized text scan', () => {
    root.innerHTML = `
      <h1>Ваш индекс социальных продаж</h1>
      <progress id="establish-brand__sub-score-bar" value="99"></progress>
      <p>13 Создание профессионального бренда</p>
      <p>4 Поиск нужных людей</p>
      <p>2 Взаимодействие с аналитическими материалами</p>
      <p>3 Установление отношений</p>
    `;

    expect(
      createSsiParser(fixedClock)
        .parse(root)
        ?.pillars.map((pillar) => pillar.score),
    ).toEqual([13, 4, 2, 3]);
  });
});
