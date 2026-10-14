// SSI API layer contracts (ISP + DIP).
//
// LinkedIn's own /sales/ssi page hydrates its charts from the internal JSON
// endpoint `/sales-api/salesApiSsi`. Hitting that endpoint directly (with the
// user's session cookies, attached automatically by the browser) yields the
// exact same numbers as the DOM — but without waiting for Ember/Highcharts to
// render, without a worker tab, and from any page. This is the primary SSI
// source in V1; the DOM parser remains a resilience fallback.

import type { SsiSnapshot } from '../types';

/** Snapshot shape produced by a source, before a capture timestamp is stamped. */
export type RawSnapshot = Omit<SsiSnapshot, 'capturedAt'>;

/** The four pillar identifiers as the API spells them. */
export type ApiPillar =
  'PROFESSIONAL_BRAND' | 'FIND_RIGHT_PEOPLE' | 'INSIGHT_ENGAGEMENT' | 'STRONG_RELATIONSHIP';

export interface ApiSubScore {
  pillar: ApiPillar;
  score: number;
}

export interface ApiScore {
  overall: number;
  subScores: ApiSubScore[];
}

export type ApiGroupType = 'INDUSTRY' | 'NETWORK';

export interface ApiGroupScore {
  groupType: ApiGroupType;
  /** Percentile rank, e.g. 75 → "Top 75%". */
  rank: number;
  score: ApiScore;
}

/** Subset of `/sales-api/salesApiSsi` we depend on (the payload has more). */
export interface SsiApiResponse {
  memberScore: ApiScore;
  groupScore?: ApiGroupScore[];
  /** false for non-Sales-Navigator members — SSI is still returned. */
  activeSeat?: boolean;
}

/**
 * Narrow GET port (DIP). The API client depends on this, not on global `fetch`,
 * so it is unit-testable with a fake. Kept separate from the LLM `HttpClient`
 * (which only POSTs) to respect ISP — neither side carries the other's methods.
 */
export interface JsonHttpGet {
  getJson<TResponse>(url: string, headers: Record<string, string>): Promise<TResponse>;
}

/**
 * Supplies the CSRF token LinkedIn requires on API calls. Its value equals the
 * `JSESSIONID` cookie (the only non-HttpOnly cookie we need to read). Abstracted
 * so the client stays free of `chrome.cookies`.
 */
export interface CsrfTokenProvider {
  /** Resolves the current CSRF token, or null if the user is not logged in. */
  getToken(): Promise<string | null>;
}

/** A source of SSI snapshots (API primary, DOM fallback both satisfy this). */
export interface SsiApiClient {
  fetchSnapshot(): Promise<RawSnapshot>;
}

/** Raised when the SSI endpoint cannot be read or interpreted. */
export class SsiApiError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SsiApiError';
  }
}

export const SSI_API_URL = 'https://www.linkedin.com/sales-api/salesApiSsi';
