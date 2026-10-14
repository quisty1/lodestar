import type { PersonCandidate } from '../types';
import { geoUrnsForRegions } from './regions';

/** LinkedIn geoUrn for India, the country key in REGION_GEO. */
export const INDIA_GEO_URN = '102713980';

/**
 * Headline tells of India-based IT staffing. Cities apply only when a card has a
 * location line (people search). Names are never matched.
 */
export const INDIA_KEYWORDS = [
  'india',
  'bengaluru',
  'bangalore',
  'mumbai',
  'delhi',
  'hyderabad',
  'chennai',
  'pune',
  'gurugram',
  'noida',
  'kolkata',
  'ahmedabad',
  'bench sales',
  'corp to corp',
  'corp-to-corp',
  'c2c',
  'us it recruiter',
  'us staffing',
];

export function resolveExcludeKeywords(settings: {
  excludeIndia?: boolean;
  excludeKeywords?: string[];
}): string[] {
  const custom = (settings.excludeKeywords ?? [])
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  const preset = settings.excludeIndia ? INDIA_KEYWORDS : [];
  return [...new Set([...preset, ...custom])];
}

export function isExcluded(
  candidate: Pick<PersonCandidate, 'headline' | 'location'>,
  keywords: string[],
): boolean {
  if (!keywords.length) return false;
  const haystack = `${candidate.headline ?? ''} ${candidate.location ?? ''}`.toLowerCase();
  return keywords.some((word) => word.length > 0 && haystack.includes(word));
}

export function filterExcluded<T extends Pick<PersonCandidate, 'headline' | 'location'>>(
  candidates: T[],
  keywords: string[],
): T[] {
  if (!keywords.length) return candidates;
  return candidates.filter((candidate) => !isExcluded(candidate, keywords));
}

/** Search geoUrns with India removed when the preset is on. */
export function geoUrnsForConnect(regions: string[], excludeIndia: boolean): string[] {
  return geoUrnsForRegions(regions).filter((urn) => !(excludeIndia && urn === INDIA_GEO_URN));
}
