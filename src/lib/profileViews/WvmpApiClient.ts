import type { ProfileViewsSnapshot } from '../types';
import type { SnapshotSource } from '../refresh/BackgroundRefreshService';
import type { HttpPostText, CsrfTokenProvider } from './contracts';
import { parseWvmpRsc, type RawProfileViews } from './wvmpParser';
import { WVMP_URL, WVMP_REQUEST_BODY } from './wvmpRequest';

/**
 * WVMP source: POST the SDUI `sduiid=WvmpAnalytics` server-request from the service
 * worker with `credentials:'include'` (browser attaches the HttpOnly session
 * cookies) + the `csrf-token` header (JSESSIONID). Mirrors the SSI API client, but
 * the response is an RSC text payload, so it parses via `parseWvmpRsc`.
 *
 * Throws (never returns a fake 0) when logged out or when the count can't be
 * parsed — the refresh service reports the error and the metric stays unknown
 * (honest degradation) rather than showing a wrong number.
 */
export class WvmpApiClient implements SnapshotSource<ProfileViewsSnapshot> {
  constructor(
    private readonly http: HttpPostText,
    private readonly csrf: CsrfTokenProvider,
  ) {}

  async fetchSnapshot(): Promise<RawProfileViews> {
    const token = await this.csrf.getToken();
    if (!token) throw new Error('WVMP: no LinkedIn session token');

    const text = await this.http.postText(
      WVMP_URL,
      { 'csrf-token': token, 'content-type': 'application/json', accept: '*/*' },
      WVMP_REQUEST_BODY,
    );

    const raw = parseWvmpRsc(text);
    if (!raw) throw new Error('WVMP: profile-views count not found in response');
    return raw;
  }
}
