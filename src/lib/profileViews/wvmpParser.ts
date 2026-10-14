import type { ProfileViewsSnapshot } from '../types';
import { wvmpWindowDays } from '../linkedin/localeLexicon';

/** Snapshot shape before the capturedAt timestamp is stamped. */
export type RawProfileViews = Omit<ProfileViewsSnapshot, 'capturedAt'>;

// The text inside each SDUI `"children":["…"]` node (single-string children only).
const CHILDREN_TOKEN = /"children":\["((?:[^"\\]|\\.)*)"\]/g;
const PURE_NUMBER = /^\d(?:[\d,.\s\u00a0\u202f]*\d)?$/u;

/** Tokens from an SDUI RSC flight payload: the string inside each `"children":["…"]`. */
function tokenizeRsc(text: string): string[] {
  return [...text.matchAll(CHILDREN_TOKEN)].map((match) => decodeRscToken(match[1]));
}

function decodeRscToken(raw: string): string {
  try {
    const decoded: unknown = JSON.parse(`"${raw}"`);
    return typeof decoded === 'string' ? decoded : raw;
  } catch {
    return raw;
  }
}

/**
 * From the ordered token list, find the WVMP label ("Profile viewers in the past
 * N days") and take the NEAREST PRECEDING pure-number token as the count. This
 * ignores distractor numbers elsewhere on the page (notification badges, "4
 * recruiters", CSS values). Returns null if the anchor is absent — the caller
 * then leaves the metric unknown rather than inventing a zero. Pure.
 */
function extractFromTokens(tokens: string[]): RawProfileViews | null {
  const labelIdx = tokens.findIndex((token) => wvmpWindowDays(token) !== null);
  if (labelIdx < 0) return null;
  const windowDays = wvmpWindowDays(tokens[labelIdx]);
  if (windowDays === null) return null;
  const adjacent = tokens[labelIdx - 1];
  if (!adjacent || !PURE_NUMBER.test(adjacent)) return null;
  const count = Number(adjacent.replace(/\D/g, ''));
  if (Number.isFinite(count)) return { count, windowDays };
  return null;
}

/**
 * Parse the WVMP count from the SDUI server-request (`sduiid=WvmpAnalytics`) RSC
 * response — the metric's only source (LinkedIn exposes no clean JSON endpoint for
 * it; the number lives in the RSC flight payload next to its label).
 */
export function parseWvmpRsc(text: string): RawProfileViews | null {
  return extractFromTokens(tokenizeRsc(text));
}
