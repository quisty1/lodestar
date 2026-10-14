import { describe, it, expect } from 'vitest';
import { LinkedInSsiApiClient } from './LinkedInSsiApiClient';
import {
  SsiApiError,
  SSI_API_URL,
  type CsrfTokenProvider,
  type JsonHttpGet,
  type SsiApiResponse,
} from './contracts';

const RESPONSE: SsiApiResponse = {
  memberScore: {
    overall: 19.7,
    subScores: [
      { score: 13.1, pillar: 'PROFESSIONAL_BRAND' },
      { score: 3.7, pillar: 'FIND_RIGHT_PEOPLE' },
      { score: 0.3, pillar: 'INSIGHT_ENGAGEMENT' },
      { score: 2.6, pillar: 'STRONG_RELATIONSHIP' },
    ],
  },
  groupScore: [{ groupType: 'INDUSTRY', rank: 75, score: { overall: 31, subScores: [] } }],
};

class FakeHttp implements JsonHttpGet {
  lastUrl?: string;
  lastHeaders?: Record<string, string>;
  constructor(private readonly impl: (url: string, headers: Record<string, string>) => unknown) {}
  async getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
    this.lastUrl = url;
    this.lastHeaders = headers;
    return this.impl(url, headers) as T;
  }
}

const csrf = (token: string | null): CsrfTokenProvider => ({
  getToken: async () => token,
});

describe('LinkedInSsiApiClient', () => {
  it('GETs the SSI endpoint and maps the payload to a snapshot', async () => {
    const http = new FakeHttp(() => RESPONSE);
    const client = new LinkedInSsiApiClient(http, csrf('ajax:123'));

    const snap = await client.fetchSnapshot();

    expect(http.lastUrl).toBe(SSI_API_URL);
    expect(snap.total).toBe(20);
    expect(snap.industryRank).toBe('Top 75%');
  });

  it('sends the CSRF token and rest.li protocol headers', async () => {
    const http = new FakeHttp(() => RESPONSE);
    await new LinkedInSsiApiClient(http, csrf('ajax:777')).fetchSnapshot();

    expect(http.lastHeaders?.['csrf-token']).toBe('ajax:777');
    expect(http.lastHeaders?.['x-restli-protocol-version']).toBe('2.0.0');
    expect(http.lastHeaders?.['accept']).toContain('*/*');
  });

  it('throws SsiApiError when the user is not logged in (no token)', async () => {
    const http = new FakeHttp(() => RESPONSE);
    await expect(new LinkedInSsiApiClient(http, csrf(null)).fetchSnapshot()).rejects.toBeInstanceOf(
      SsiApiError,
    );
  });

  it('wraps transport failures in SsiApiError', async () => {
    const http = new FakeHttp(() => {
      throw new Error('HTTP 403 SALES_SEAT_REQUIRED');
    });
    await expect(
      new LinkedInSsiApiClient(http, csrf('ajax:1')).fetchSnapshot(),
    ).rejects.toBeInstanceOf(SsiApiError);
  });

  it('wraps malformed payloads (mapper failure) in SsiApiError', async () => {
    const http = new FakeHttp(() => ({}));
    await expect(
      new LinkedInSsiApiClient(http, csrf('ajax:1')).fetchSnapshot(),
    ).rejects.toBeInstanceOf(SsiApiError);
  });
});
