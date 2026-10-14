// Pure parsing helpers for the SSI engine.
// No DOM, no chrome, no side effects — fully unit-testable.

/**
 * Parse a numeric score from raw LinkedIn text.
 * Handles locale decimals ("23,4" → 23.4), surrounding noise, and rounding hints.
 * Returns null when no number can be recovered.
 */
export function parseScore(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  // Grab the first number, allowing ',' or '.' as decimal separator.
  const match = raw.replace(/\u00A0/g, ' ').match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/** Clamp a single SSI pillar score into LinkedIn's 0..25 range. NaN → 0. */
export function clampPillar(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(25, Math.max(0, score));
}

/**
 * Normalise a rank string to a canonical "Top N%" form.
 * Accepts "Top 4%", "верхние 4 %", "4%" → "Top 4%". Returns null if no percent found.
 */
export function normaliseRank(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const match = raw.replace(/\u00A0/g, ' ').match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!match) return null;
  const pct = match[1].replace(',', '.');
  return `Top ${pct}%`;
}

/** Sum pillar scores into the 0..100 total, clamping each pillar defensively. */
export function sumPillars(scores: number[]): number {
  return scores.reduce<number>((acc, s) => acc + clampPillar(s), 0);
}
