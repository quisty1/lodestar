import type { SsiPillarKey, SsiSnapshot } from '@lib/types';

export interface PillarView {
  key: SsiPillarKey;
  label: string;
  /** "19/25" */
  score: string;
  /** 0..100 width percentage of the 0..25 score. */
  pct: number;
  /** Legacy fill field retained for view-model compatibility; neutral solid accent. */
  gradient: string;
}

/** Map a snapshot's pillars to render-ready view models. Pure. */
export function pillarsToView(snapshot: SsiSnapshot): PillarView[] {
  return snapshot.pillars.map((p) => ({
    key: p.key,
    label: p.label,
    score: `${round(p.score)}/25`,
    pct: clampPct((p.score / 25) * 100),
    gradient: 'var(--accent)',
  }));
}

function round(n: number): number {
  return Math.round(n);
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}
