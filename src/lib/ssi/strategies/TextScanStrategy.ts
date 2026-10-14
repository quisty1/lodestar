import type { SsiSnapshot } from '../../types';
import type { SsiParseStrategy } from '../../ports';
import { SSI_PAGE_MARKERS } from '../../linkedin/localeLexicon';
import { PILLARS } from '../pillars';
import { clampPillar, parseScore, sumPillars } from '../parse-helpers';

/** First number within `chars` after position 0 of a fragment, with its gap. */
function numberAfter(fragment: string): { value: number; gap: number } | null {
  const m = fragment.match(/-?\d+(?:[.,]\d+)?/);
  if (!m || m.index == null) return null;
  const value = parseScore(m[0]);
  return value == null ? null : { value, gap: m.index };
}

/** Last number in a fragment (closest to its end), with its gap to the end. */
function numberBefore(fragment: string): { value: number; gap: number } | null {
  const all = [...fragment.matchAll(/-?\d+(?:[.,]\d+)?/g)];
  const m = all[all.length - 1];
  if (!m || m.index == null) return null;
  const value = parseScore(m[0]);
  if (value == null) return null;
  return { value, gap: fragment.length - (m.index + m[0].length) };
}

const WINDOW = 16;

/**
 * Resilient fallback: pair each pillar label with a nearby number in the page
 * text. LinkedIn renders the score either before the label ("13.118 Establish
 * your professional brand", the live /sales/ssi layout) or after it ("...brand
 * 18", some legacy surfaces). A single matcher can't tell which — the adjacent
 * number could be its own or the neighbour's — so we detect the dominant layout
 * across all four pillars first, then read every score from that side.
 *
 * Used only when DomSelectorStrategy fails (LSP: same contract, lower precision).
 */
export class TextScanStrategy implements SsiParseStrategy {
  readonly name = 'text-scan';

  parse(root: ParentNode): Omit<SsiSnapshot, 'capturedAt'> | null {
    const text = (root.textContent ?? '').toLowerCase();
    if (!SSI_PAGE_MARKERS.some((marker) => text.includes(marker))) return null;

    const candidates = PILLARS.map((def) => this.candidate(text, def.matchers));
    if (!candidates.some((c) => c?.after != null || c?.before != null)) return null;

    // Detect dominant layout: count which side carries a number per pillar.
    const afterHits = candidates.filter((c) => c?.after != null).length;
    const beforeHits = candidates.filter((c) => c?.before != null).length;
    const side: 'before' | 'after' = beforeHits > afterHits ? 'before' : 'after';

    const pillars = PILLARS.map((def, i) => {
      const c = candidates[i];
      // Never borrow a neighbour's score from the opposite layout side.
      const pick = c?.[side];
      return {
        key: def.key,
        label: def.label,
        score: clampPillar(pick?.value ?? Number.NaN),
        found: pick != null,
      };
    });

    if (!pillars.every((p) => p.found)) return null;

    return {
      total: sumPillars(pillars.map((p) => p.score)),
      pillars: pillars.map(({ key, label, score }) => ({ key, label, score })),
    };
  }

  /** Numbers on each side of the first matcher occurrence (tight windows). */
  private candidate(
    haystack: string,
    matchers: readonly string[],
  ): {
    before: { value: number; gap: number } | null;
    after: { value: number; gap: number } | null;
  } | null {
    for (const matcher of matchers) {
      const idx = haystack.indexOf(matcher);
      if (idx === -1) continue;
      const end = idx + matcher.length;
      return {
        before: numberBefore(haystack.slice(Math.max(0, idx - WINDOW), idx)),
        after: numberAfter(haystack.slice(end, end + WINDOW)),
      };
    }
    return null;
  }
}
