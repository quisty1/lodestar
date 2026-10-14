/**
 * Build the LinkedIn people-search URL for the given keywords + optional geo filters.
 * geoUrns are OR'd (results in ANY of the regions). Pure.
 */
export function peopleSearchUrl(keywords: string, geoUrns: string[] = []): string {
  const q = encodeURIComponent(keywords.trim());
  let url = `https://www.linkedin.com/search/results/people/?keywords=${q}`;
  if (geoUrns.length > 0) {
    url += `&geoUrn=${encodeURIComponent(JSON.stringify(geoUrns))}&origin=FACETED_SEARCH`;
  }
  return url;
}
