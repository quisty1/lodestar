import { describe, it, expect } from 'vitest';
import {
  COUNTRIES,
  REGION_GEO,
  REGION_KEYS,
  countryNameRu,
  expandLegacyRegions,
  filterCountries,
  geoUrnsForRegions,
} from './regions';

describe('connect regions', () => {
  it('lists every LinkedIn country once, with the verified control ids', () => {
    expect(COUNTRIES.length).toBeGreaterThan(200);
    expect(REGION_KEYS).toEqual(COUNTRIES.map((country) => country.iso));
    expect(new Set(REGION_KEYS).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map((country) => country.geoUrn)).size).toBe(COUNTRIES.length);
    expect(REGION_GEO.DE).toEqual(['101282230']);
    expect(REGION_GEO.US).toEqual(['103644278']);
    expect(REGION_GEO.GE).toEqual(['106315325']);
    expect(COUNTRIES.find((country) => country.iso === 'GE')?.name).toBe('Georgia');
  });

  it('flattens + dedups geoUrns for the selected countries; ignores unknown keys', () => {
    expect(geoUrnsForRegions(['US', 'CA'])).toEqual(['103644278', '101174742']);
    expect(geoUrnsForRegions(['DE', 'GB'])).toEqual(['101282230', '101165590']);
    expect(geoUrnsForRegions(['US', 'bogus'])).toEqual(['103644278']);
    expect(geoUrnsForRegions([])).toEqual([]);
  });

  it('expands legacy bundles and English country names into ISO codes', () => {
    expect(expandLegacyRegions(['Europe', 'Asia', 'US'])).toEqual(['DE', 'GB', 'IN', 'SG', 'US']);
    expect(expandLegacyRegions(['Germany', 'Europe'])).toEqual(['DE', 'GB']);
    expect(expandLegacyRegions(['UAE', 'UK'])).toEqual(['AE', 'GB']);
    expect(geoUrnsForRegions(['Europe'])).toEqual(['101282230', '101165590']);
    expect(geoUrnsForRegions(['Asia'])).toEqual(['102713980', '102454443']);
  });

  it('filters by Russian name, English name, and ISO code', () => {
    expect(countryNameRu('DE')).toBe('Германия');
    expect(filterCountries('герм').map((country) => country.iso)).toContain('DE');
    expect(filterCountries('Germany').map((country) => country.iso)).toContain('DE');
    expect(filterCountries('kz').map((country) => country.iso)).toContain('KZ');
    expect(filterCountries('нет такой страны')).toEqual([]);
  });
});
