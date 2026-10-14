/**
 * LinkedIn country geoUrns. The catalog is countries.json, built once from LinkedIn's
 * public geo typeahead (country hit, not a city). Germany 101282230 matches the id
 * verified live on 2026-06-26. Georgia is the country 106315325, not the US state.
 * Selected ids are OR'd into one people-search.
 */
import countries from './countries.json';

export interface LinkedInCountry {
  iso: string;
  geoUrn: string;
  name: string;
}

export const COUNTRIES: LinkedInCountry[] = countries;

export const REGION_GEO: Record<string, string[]> = Object.fromEntries(
  COUNTRIES.map((country) => [country.iso, [country.geoUrn]]),
);

export const REGION_KEYS = COUNTRIES.map((country) => country.iso);

/** Saved bundles and English keys from before ISO country codes. */
const LEGACY_REGIONS: Record<string, string[]> = {
  Europe: ['DE', 'GB'],
  Asia: ['IN', 'SG'],
  Cyprus: ['CY'],
  Germany: ['DE'],
  Serbia: ['RS'],
  Malta: ['MT'],
  Finland: ['FI'],
  Netherlands: ['NL'],
  Ireland: ['IE'],
  Sweden: ['SE'],
  Poland: ['PL'],
  Portugal: ['PT'],
  Spain: ['ES'],
  Russia: ['RU'],
  Armenia: ['AM'],
  Georgia: ['GE'],
  Kazakhstan: ['KZ'],
  Canada: ['CA'],
  UAE: ['AE'],
  UK: ['GB'],
  India: ['IN'],
  Singapore: ['SG'],
};

const russianNames = new Intl.DisplayNames(['ru'], { type: 'region' });

export function countryFlag(iso: string): string {
  if (!/^[A-Z]{2}$/.test(iso)) return '';
  const points: number[] = [];
  for (const char of iso) points.push(127397 + char.charCodeAt(0));
  return String.fromCodePoint(...points);
}

export function countryNameRu(iso: string): string {
  return russianNames.of(iso) ?? iso;
}

export function countryLabel(iso: string): string {
  const flag = countryFlag(iso);
  const name = countryNameRu(iso);
  return flag ? `${flag} ${name}` : name;
}

/** Russian name, then English LinkedIn name, for a stable picker order. */
export function compareCountries(a: LinkedInCountry, b: LinkedInCountry): number {
  const byRu = countryNameRu(a.iso).localeCompare(countryNameRu(b.iso), 'ru');
  return byRu || a.name.localeCompare(b.name, 'en');
}

/** Match a query against the Russian name, the English LinkedIn name, and the ISO code. */
export function filterCountries(query: string): LinkedInCountry[] {
  const q = query.trim().toLowerCase();
  const sorted = [...COUNTRIES].sort(compareCountries);
  if (!q) return sorted;
  return sorted.filter(
    (country) =>
      country.iso.toLowerCase().includes(q) ||
      country.name.toLowerCase().includes(q) ||
      countryNameRu(country.iso).toLowerCase().includes(q),
  );
}

/**
 * Turn saved region keys into ISO country codes. Legacy bundles expand in place;
 * unknown keys are dropped; duplicates are removed.
 */
export function expandLegacyRegions(regions: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const region of regions) {
    for (const key of LEGACY_REGIONS[region] ?? [region]) {
      if (!REGION_GEO[key] || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** Flattened, deduped geoUrns for the selected region keys (unknown keys ignored). */
export function geoUrnsForRegions(regions: string[]): string[] {
  const out = new Set<string>();
  for (const code of expandLegacyRegions(regions)) {
    for (const geo of REGION_GEO[code] ?? []) out.add(geo);
  }
  return [...out];
}
