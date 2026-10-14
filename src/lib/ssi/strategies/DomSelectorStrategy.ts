import type { SsiSnapshot } from '../../types';
import type { SsiParseStrategy } from '../../ports';
import { PILLARS, RANK_MATCHERS } from '../pillars';
import { parseScore, clampPillar, normaliseRank, sumPillars } from '../parse-helpers';

/**
 * Primary strategy: read structured elements on /sales/ssi.
 *
 * Selector contract (verified against a live capture 2026-06). All brittle
 * LinkedIn coupling lives HERE (SRP); the rest of the codebase never sees a
 * raw class name. Resolution order per datum, most → least robust:
 *
 *  pillars : [data-lodestar-pillar="<key>"]               (content-script overlay)
 *          → #<domId> <progress value="…">                (exact numeric attr)
 *          → .ssi-pillar-<key>                            (legacy/synthetic)
 *  total   : [data-lodestar-ssi="total"]
 *          → .user-ssi-score__donut-chart-caption .ssi-score__value
 *          → .ssi-total-score
 *          → Σ pillars
 *  ranks   : [data-lodestar-rank="…"]
 *          → .ssi-rank rows (dt label → dd score)
 *
 * The `data-lodestar-*` overlay lets the content script tag nodes it recognises,
 * so a future LinkedIn redesign is patched in one place.
 */
export class DomSelectorStrategy implements SsiParseStrategy {
  readonly name = 'dom-selector';

  parse(root: ParentNode): Omit<SsiSnapshot, 'capturedAt'> | null {
    const pillars = PILLARS.map((def) => {
      // 1. Content-script overlay (textContent holds the number).
      const overlay = root.querySelector(`[data-lodestar-pillar="${def.key}"]`);
      if (overlay) {
        const score = parseScore(overlay.textContent);
        if (score != null) return pillar(def, score);
      }

      // 2. Real LinkedIn: <progress> exposes an exact numeric `value` attribute.
      const progress = byId(root, def.domId);
      const fromAttr = parseScore(progress?.getAttribute('value'));
      if (fromAttr != null) return pillar(def, fromAttr);

      // 2b. Same node, fall back to its accessible/label text if attr missing.
      const fromText = parseScore(progress?.textContent);
      if (fromText != null) return pillar(def, fromText);

      // 3. Legacy/synthetic class hook.
      const legacy = root.querySelector(`.ssi-pillar-${def.key}`);
      const fromLegacy = parseScore(legacy?.textContent);
      if (fromLegacy != null) return pillar(def, fromLegacy);

      return { key: def.key, label: def.label, score: 0, found: false };
    });

    // Partial results must fall through: zero-filled pillars look like real scores
    // and would suppress a complete localized text strategy.
    if (!pillars.every((p) => p.found)) return null;

    const total = this.readTotal(root) ?? sumPillars(pillars.map((p) => p.score));
    const industryRank = this.readRank(root, 'industry');
    const networkRank = this.readRank(root, 'network');

    return {
      total,
      pillars: pillars.map(({ key, label, score }) => ({ key, label, score })),
      ...(industryRank ? { industryRank } : {}),
      ...(networkRank ? { networkRank } : {}),
    };
  }

  private readTotal(root: ParentNode): number | null {
    const overlay = root.querySelector('[data-lodestar-ssi="total"]');
    const fromOverlay = parseScore(overlay?.textContent);
    if (fromOverlay != null) return fromOverlay;

    // The user's own donut caption ("20 out of 100"). Scoped so the peer-group
    // comparison donuts (.group-ssi-score) can never be picked up by mistake.
    const caption = root.querySelector('.user-ssi-score__donut-chart-caption .ssi-score__value');
    const fromCaption = parseScore(caption?.textContent);
    if (fromCaption != null) return fromCaption;

    return parseScore(root.querySelector('.ssi-total-score')?.textContent);
  }

  private readRank(root: ParentNode, kind: 'industry' | 'network'): string | undefined {
    const overlay = root.querySelector(`[data-lodestar-rank="${kind}"]`);
    const fromOverlay = normaliseRank(overlay?.textContent);
    if (fromOverlay) return fromOverlay;

    const needles = RANK_MATCHERS[kind];
    for (const row of Array.from(root.querySelectorAll('.ssi-rank'))) {
      const label = (
        row.querySelector('.ssi-rank__category-name')?.textContent ?? ''
      ).toLowerCase();
      if (!needles.some((n) => label.includes(n))) continue;
      const rank = normaliseRank(row.querySelector('.ssi-rank__category-score')?.textContent);
      if (rank) return rank;
    }
    return undefined;
  }
}

function pillar(
  def: (typeof PILLARS)[number],
  score: number,
): { key: SsiSnapshot['pillars'][number]['key']; label: string; score: number; found: true } {
  return { key: def.key, label: def.label, score: clampPillar(score), found: true };
}

/** querySelector by id without needing the id to be a valid CSS identifier. */
function byId(root: ParentNode, id: string): Element | null {
  if ('getElementById' in root && typeof (root as Document).getElementById === 'function') {
    return (root as Document).getElementById(id);
  }
  return root.querySelector(`[id="${id}"]`);
}
