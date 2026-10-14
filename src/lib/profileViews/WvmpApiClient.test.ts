import { describe, it, expect } from 'vitest';
import { WvmpApiClient } from './WvmpApiClient';
import { WVMP_URL, WVMP_REQUEST_BODY } from './wvmpRequest';
import { WVMP_RSC_FIXTURE } from './fixtures/wvmpFixtures';
import type { HttpPostText, CsrfTokenProvider } from './contracts';

const csrf = (t: string | null): CsrfTokenProvider => ({ getToken: async () => t });

describe('WvmpApiClient (boundary: SDUI POST → real RSC → parser)', () => {
  it('POSTs WvmpAnalytics with csrf + real body and returns the parsed rolling count', async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const http: HttpPostText = {
      postText: async (url, headers, body) => {
        calls.push({ url, headers, body });
        return WVMP_RSC_FIXTURE;
      },
    };
    const raw = await new WvmpApiClient(http, csrf('ajax:1234567890')).fetchSnapshot();

    expect(raw).toEqual({ count: 45, windowDays: 90 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(WVMP_URL);
    expect(calls[0].headers['csrf-token']).toBe('ajax:1234567890');
    expect(calls[0].headers['content-type']).toBe('application/json');
    expect(calls[0].body).toBe(WVMP_REQUEST_BODY);
  });

  it('throws when there is no session token (logged out) — no fake zero', async () => {
    const http: HttpPostText = { postText: async () => WVMP_RSC_FIXTURE };
    await expect(new WvmpApiClient(http, csrf(null)).fetchSnapshot()).rejects.toThrow(
      /session token/,
    );
  });

  it('throws when the response carries no WVMP count (contract drift)', async () => {
    const http: HttpPostText = { postText: async () => '{"children":["unrelated card"]}' };
    await expect(new WvmpApiClient(http, csrf('t')).fetchSnapshot()).rejects.toThrow(/not found/);
  });
});
