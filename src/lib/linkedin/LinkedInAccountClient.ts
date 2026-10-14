import type { JsonHttpGet, CsrfTokenProvider } from '../ssi-api/contracts';
import { readLinkedInAccount, type LinkedInAccount } from './account';

export const LINKEDIN_ME_URL = 'https://www.linkedin.com/voyager/api/me';

export class LinkedInAccountClient {
  constructor(
    private readonly http: JsonHttpGet,
    private readonly csrf: CsrfTokenProvider,
  ) {}

  async fetchAccount(capturedAt: string): Promise<LinkedInAccount | null> {
    const token = await this.csrf.getToken();
    if (!token) return null;
    const payload = await this.http.getJson<unknown>(LINKEDIN_ME_URL, {
      accept: 'application/vnd.linkedin.normalized+json+2.1',
      'csrf-token': token,
      'x-restli-protocol-version': '2.0.0',
    });
    return readLinkedInAccount(payload, capturedAt);
  }
}
