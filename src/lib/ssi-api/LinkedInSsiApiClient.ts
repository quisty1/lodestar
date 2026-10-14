import { mapApiResponse } from './mapApiResponse';
import {
  SsiApiError,
  SSI_API_URL,
  type CsrfTokenProvider,
  type JsonHttpGet,
  type RawSnapshot,
  type SsiApiClient,
  type SsiApiResponse,
} from './contracts';

/**
 * Primary SSI source: reads `/sales-api/salesApiSsi` directly.
 *
 * SRP: assemble the authenticated request, delegate transport to the injected
 * GET port, delegate interpretation to the pure mapper. Cookies (li_at etc.)
 * are HttpOnly and attached by the browser automatically via credentials;
 * the only header we must set by hand is the CSRF token (= JSESSIONID value).
 *
 * Every failure mode surfaces as a single SsiApiError so callers (the refresh
 * orchestrator) can fall back to the DOM parser uniformly.
 */
export class LinkedInSsiApiClient implements SsiApiClient {
  constructor(
    private readonly http: JsonHttpGet,
    private readonly csrf: CsrfTokenProvider,
  ) {}

  async fetchSnapshot(): Promise<RawSnapshot> {
    const token = await this.csrf.getToken();
    if (!token) {
      throw new SsiApiError('No LinkedIn session token (user not logged in)');
    }

    let payload: SsiApiResponse;
    try {
      payload = await this.http.getJson<SsiApiResponse>(SSI_API_URL, {
        accept: '*/*',
        'csrf-token': token,
        'x-restli-protocol-version': '2.0.0',
      });
    } catch (cause) {
      throw new SsiApiError('SSI endpoint request failed', cause);
    }

    try {
      return mapApiResponse(payload);
    } catch (cause) {
      if (cause instanceof SsiApiError) throw cause;
      throw new SsiApiError('SSI response could not be interpreted', cause);
    }
  }
}
