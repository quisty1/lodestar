import type { CsrfTokenProvider } from '@lib/ssi-api/contracts';
import { LINKEDIN_ORIGIN } from '@lib/linkedin/urls';

const JSESSIONID = 'JSESSIONID';

/**
 * Reads the LinkedIn CSRF token from the JSESSIONID cookie via chrome.cookies.
 *
 * JSESSIONID is the one cookie LinkedIn does NOT mark HttpOnly, precisely so
 * its own web app can echo it back as the `csrf-token` header. LinkedIn stores
 * it quoted (`"ajax:123…"`); we strip the surrounding quotes. Requires the
 * `cookies` permission + host access to linkedin.com.
 */
export class ChromeCookieCsrfProvider implements CsrfTokenProvider {
  async getToken(): Promise<string | null> {
    const cookie = await chrome.cookies.get({ url: LINKEDIN_ORIGIN, name: JSESSIONID });
    if (!cookie?.value) return null;
    return cookie.value.replace(/^"|"$/g, '');
  }
}
