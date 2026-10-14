import type { SsiPillarKey } from '../types';
import { SSI_PILLAR_MATCHERS } from '../linkedin/localeLexicon';

/**
 * Canonical pillar order + localized matchers. LinkedIn renders these four,
 * always summing to 100. Order here is the canonical display order.
 */
export interface PillarDef {
  key: SsiPillarKey;
  label: string;
  /**
   * Stable `id` of the LinkedIn <progress> bar on /sales/ssi. These ids are
   * semantic and language-independent (verified against a live capture 2026-06),
   * and the element exposes an exact numeric `value` attribute — preferred over
   * scraping text. This is the single brittle coupling to LinkedIn's markup.
   */
  domId: string;
  /** Exact locale-specific headings that identify this pillar in page text. */
  matchers: readonly string[];
}

export const PILLARS: readonly PillarDef[] = [
  {
    key: 'brand',
    label: 'Профессиональный бренд',
    domId: 'establish-brand__sub-score-bar',
    matchers: SSI_PILLAR_MATCHERS.brand,
  },
  {
    key: 'people',
    label: 'Нужные люди',
    domId: 'find-people__sub-score-bar',
    matchers: SSI_PILLAR_MATCHERS.people,
  },
  {
    key: 'insights',
    label: 'Инсайты',
    domId: 'engage-with-insights__sub-score-bar',
    matchers: SSI_PILLAR_MATCHERS.insights,
  },
  {
    key: 'relationships',
    label: 'Отношения',
    domId: 'build-relationships__sub-score-bar',
    matchers: SSI_PILLAR_MATCHERS.relationships,
  },
];

/** Lowercased substrings that classify the two SSI rank rows (EN + RU + RO). */
export const RANK_MATCHERS = {
  industry: ['industry', 'отрасл', 'industrie'],
  network: ['network', 'сет', 'rețea'],
} as const;

export const PILLAR_KEYS: readonly SsiPillarKey[] = PILLARS.map((p) => p.key);
