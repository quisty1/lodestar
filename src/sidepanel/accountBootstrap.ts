import { ChromeCookieCsrfProvider } from '@/adapters/ChromeCookieCsrfProvider';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import { FetchHttpClient } from '@/adapters/FetchHttpClient';
import { SystemClock } from '@/adapters/SystemClock';
import { LinkedInAccountClient } from '@lib/linkedin/LinkedInAccountClient';
import { ensureLinkedInAccount } from '@lib/linkedin/ensureAccount';

/** Resolves the signed-in account for the panel. Storage stays readable until the worker closes it. */
export function startPanelAccount(): void {
  const local = globalThis.chrome?.storage?.local;
  const cookies = globalThis.chrome?.cookies;
  if (!local?.get || !local.set || !cookies) return;
  void ensureLinkedInAccount({
    store: new ChromeStorageStore(),
    client: new LinkedInAccountClient(new FetchHttpClient(), new ChromeCookieCsrfProvider()),
    clock: new SystemClock(),
  }).catch(() => undefined);
}
