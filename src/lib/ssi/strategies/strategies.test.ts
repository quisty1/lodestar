import { describe, it, expect } from 'vitest';
import { DomSelectorStrategy } from './DomSelectorStrategy';
import { TextScanStrategy } from './TextScanStrategy';

function dom(html: string): ParentNode {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('DomSelectorStrategy', () => {
  const strategy = new DomSelectorStrategy();

  it('reads total, four pillars and ranks from tagged nodes', () => {
    const root = dom(`
      <div data-lodestar-ssi="total">71</div>
      <div data-lodestar-pillar="brand">18</div>
      <div data-lodestar-pillar="people">20</div>
      <div data-lodestar-pillar="insights">15</div>
      <div data-lodestar-pillar="relationships">18</div>
      <span data-lodestar-rank="industry">Top 4%</span>
      <span data-lodestar-rank="network">Top 1%</span>
    `);
    const r = strategy.parse(root);
    expect(r?.total).toBe(71);
    expect(r?.pillars.map((p) => p.score)).toEqual([18, 20, 15, 18]);
    expect(r?.industryRank).toBe('Top 4%');
    expect(r?.networkRank).toBe('Top 1%');
  });

  it('derives total from pillars when total node is absent', () => {
    const root = dom(`
      <div class="ssi-pillar-brand">18</div>
      <div class="ssi-pillar-people">20</div>
      <div class="ssi-pillar-insights">15</div>
      <div class="ssi-pillar-relationships">18</div>
    `);
    expect(strategy.parse(root)?.total).toBe(71);
  });

  it('returns null when no pillar nodes exist', () => {
    expect(strategy.parse(dom('<div>nothing here</div>'))).toBeNull();
  });

  it('returns null when only some structural pillars exist', () => {
    expect(strategy.parse(dom('<div data-lodestar-pillar="brand">18</div>'))).toBeNull();
  });

  it('clamps an out-of-range pillar score', () => {
    const root = dom(`
      <div data-lodestar-pillar="brand">99</div>
      <div data-lodestar-pillar="people">1</div>
      <div data-lodestar-pillar="insights">1</div>
      <div data-lodestar-pillar="relationships">1</div>
    `);
    expect(strategy.parse(root)?.pillars[0].score).toBe(25);
  });

  // Mirrors the real /sales/ssi markup captured 2026-06: pillars are <progress>
  // bars with stable ids + exact `value` attrs; the total lives in the user's
  // donut caption; ranks in .ssi-rank rows. A decoy peer-group donut is included
  // to prove the total selector is scoped to the user's own score.
  it('parses the real LinkedIn /sales/ssi structure', () => {
    const root = dom(`
      <dl class="ssi-ranks">
        <div class="ssi-rank">
          <dt class="ssi-rank__category-name">Industry SSI rank</dt>
          <dd class="ssi-rank__category-score">Top <span class="t-40">75</span>%</dd>
        </div>
        <div class="ssi-rank">
          <dt class="ssi-rank__category-name">Network SSI rank</dt>
          <dd class="ssi-rank__category-score">Top <span class="t-40">81</span>%</dd>
        </div>
      </dl>

      <div class="user-ssi-score">
        <figcaption class="user-ssi-score__donut-chart-caption">
          <span class="ssi-score__value">20</span> out of 100
        </figcaption>
        <progress id="establish-brand__sub-score-bar" value="13.118002" max="25">
          <span class="ssi-score__value">13.118</span> out of 25
        </progress>
        <progress id="find-people__sub-score-bar" value="3.68" max="25"></progress>
        <progress id="engage-with-insights__sub-score-bar" value="0.29999998" max="25"></progress>
        <progress id="build-relationships__sub-score-bar" value="2.6077502" max="25"></progress>
      </div>

      <!-- decoy: peer-group comparison donut must NOT be read as the total -->
      <div class="group-ssi-score">
        <figcaption class="group-ssi-score__donut-chart">
          <span class="ssi-score__value">31</span> out of 100
        </figcaption>
      </div>
    `);
    const r = strategy.parse(root);
    expect(r?.total).toBe(20);
    expect(r?.pillars.map((p) => p.score)).toEqual([13.118002, 3.68, 0.29999998, 2.6077502]);
    expect(r?.industryRank).toBe('Top 75%');
    expect(r?.networkRank).toBe('Top 81%');
  });

  it('falls back to <progress> label text when value attr is absent', () => {
    const root = dom(`
      <progress id="establish-brand__sub-score-bar" max="25">
        <span class="ssi-score__value">18</span> out of 25
      </progress>
      <progress id="find-people__sub-score-bar" value="1" max="25"></progress>
      <progress id="engage-with-insights__sub-score-bar" value="1" max="25"></progress>
      <progress id="build-relationships__sub-score-bar" value="1" max="25"></progress>
    `);
    expect(strategy.parse(root)?.pillars[0].score).toBe(18);
  });
});

describe('TextScanStrategy', () => {
  const strategy = new TextScanStrategy();

  it('extracts pillar scores from loose English text', () => {
    const root = dom(`
      <h1>Your Social Selling Index</h1>
      <p>Establish your professional brand 18</p>
      <p>Find the right people 20</p>
      <p>Engage with insights 15</p>
      <p>Build relationships 18</p>
    `);
    const r = strategy.parse(root);
    expect(r?.total).toBe(71);
    expect(r?.pillars).toHaveLength(4);
  });

  it('extracts scores when the number precedes the label (real layout)', () => {
    const root = dom(`
      <h1>Your Social Selling Index</h1>
      <p>13.118 Establish your professional brand</p>
      <p>3.68 Find the right people</p>
      <p>0.3 Engage with insights</p>
      <p>2.608 Build relationships</p>
    `);
    const r = strategy.parse(root);
    expect(r?.pillars.map((p) => p.score)).toEqual([13.118, 3.68, 0.3, 2.608]);
  });

  it('does not apply when the page is not an SSI page', () => {
    expect(strategy.parse(dom('<p>Find the right people 20</p>'))).toBeNull();
  });

  it.each([
    [
      'ru',
      `
      <h1>Ваш индекс социальных продаж</h1>
      <p>13 Создание профессионального бренда</p>
      <p>4 Поиск нужных людей</p>
      <p>2 Взаимодействие с аналитическими материалами</p>
      <p>3 Установление отношений</p>
    `,
    ],
    [
      'ro',
      `
      <h1>Indicele dvs. de vânzări sociale</h1>
      <p>13 Construiește-ți brandul profesional</p>
      <p>4 Găsește persoanele potrivite</p>
      <p>2 Interacționează cu informații</p>
      <p>3 Construiește relații</p>
    `,
    ],
  ])('extracts all four pillars from exact %s fallback copy', (_locale, html) => {
    expect(strategy.parse(dom(html))?.pillars.map((pillar) => pillar.score)).toEqual([13, 4, 2, 3]);
  });

  it('rejects a before-score layout when one pillar has no score on that side', () => {
    expect(
      strategy.parse(
        dom(`
      <h1>Your Social Selling Index</h1>
      <p>13 Establish your professional brand</p>
      <p>Find the right people</p>
      <p>2 Engage with insights</p>
      <p>3 Build relationships</p>
    `),
      ),
    ).toBeNull();
  });
});
