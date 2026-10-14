export const LINKEDIN_ORIGIN = 'https://www.linkedin.com';
export const LINKEDIN_MATCH_PATTERN = `${LINKEDIN_ORIGIN}/*`;
export const LINKEDIN_FEED_URL = `${LINKEDIN_ORIGIN}/feed/`;

/** Exact origin supported by manifest injection, cookies and worker navigation. */
export function isSupportedLinkedInUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.origin === LINKEDIN_ORIGIN && !url.username && !url.password;
  } catch {
    return false;
  }
}
