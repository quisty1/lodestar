import type { CsrfTokenProvider } from '../ssi-api/contracts';

// CSRF derivation (JSESSIONID) is identical to SSI — reuse the same port and
// adapter rather than duplicate it.
export type { CsrfTokenProvider };

/**
 * Narrow POST-returning-text port (ISP). WVMP's SDUI endpoint replies with an RSC
 * text body (not JSON), so this is deliberately separate from the SSI `JsonHttpGet`
 * and the LLM `HttpClient` ports. `FetchHttpClient` structurally satisfies it.
 */
export interface HttpPostText {
  postText(url: string, headers: Record<string, string>, body: string): Promise<string>;
}
