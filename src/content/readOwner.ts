/**
 * The logged-in user's display name, read from the feed chrome — so the engagement
 * loop never likes or comments the OWNER's own posts (the 2026-06-29 self-engagement
 * bug: an auto-published post sat atop the feed and got self-liked + commented ×3).
 *
 * Hash-/locale-independent anchors validated against the live feed:
 *  1. The stable sharebox component identifies the owner's `/in/<vanity>` link, in the
 *     light DOM or in the open `#interop-outlet` shadow root. Without that proof we
 *     return null rather than mistake a recommendation for the owner.
 *  2. Same-vanity anchors can expose the clean name through avatar alt or accessible image
 *     label; structured text is accepted only inside the self-card aside.
 *
 * Returns null while identity is unavailable; the caller owns the safety policy.
 */
const PROFILE_LINK = 'a[href*="/in/"]';
const SELF_CARD_PROFILE_LINK = `aside ${PROFILE_LINK}`;
const SHAREBOX =
  '#shareboxProfilePictureComponentRef, [componentkey="shareboxProfilePictureComponentRef"]';
const SHADOW_HOST = '#interop-outlet, [data-testid="interop-shadowdom"]';
const DEFAULT_ATTEMPTS = 40;
const DEFAULT_INTERVAL_MS = 250;

function normaliseName(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function readVanity(link: HTMLAnchorElement | null): string | null {
  return link?.getAttribute('href')?.match(/\/in\/([^/?]+)/)?.[1] ?? null;
}

function readAttributeName(
  anchors: HTMLAnchorElement[],
  selector: string,
  attribute: string,
): string | null {
  for (const anchor of anchors) {
    for (const element of anchor.querySelectorAll<HTMLElement>(selector)) {
      const name = normaliseName(element.getAttribute(attribute));
      if (name) return name;
    }
  }
  return null;
}

export function readOwnerName(root: ParentNode): string | null {
  const scopes = searchRoots(root);
  const sharebox =
    scopes
      .map((scope) => scope.querySelector<HTMLElement>(SHAREBOX))
      .find((element) => element !== null) ?? null;
  const ownerLink = sharebox?.querySelector<HTMLAnchorElement>(PROFILE_LINK) ?? null;
  const vanity = readVanity(ownerLink);
  if (!vanity) return null;

  const anchors = scopes.flatMap((scope) =>
    Array.from(scope.querySelectorAll<HTMLAnchorElement>(PROFILE_LINK)).filter(
      (anchor) => readVanity(anchor) === vanity,
    ),
  );
  const labelledName =
    readAttributeName(anchors, 'img[alt]', 'alt') ??
    readAttributeName(anchors, '[role="img"][aria-label]', 'aria-label');
  if (labelledName) return labelledName;

  for (const scope of scopes) {
    for (const anchor of scope.querySelectorAll<HTMLAnchorElement>(SELF_CARD_PROFILE_LINK)) {
      if (readVanity(anchor) !== vanity) continue;
      for (const nameBlock of anchor.querySelectorAll('p > span')) {
        const name = normaliseName(nameBlock.textContent);
        if (name) return name;
      }
    }
  }
  return null;
}

function searchRoots(root: ParentNode): ParentNode[] {
  const host = root.querySelector<HTMLElement>(SHADOW_HOST);
  return host?.shadowRoot ? [root, host.shadowRoot] : [root];
}

export function ownerCardPresent(root: ParentNode): boolean {
  return searchRoots(root).some((scope) => scope.querySelector(SHAREBOX) !== null);
}

export interface WaitForOwnerNameOptions {
  attempts?: number;
  intervalMs?: number;
  wait?: (ms: number) => Promise<void>;
  shouldAbort?: () => boolean;
}

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForOwnerName(
  root: ParentNode,
  options: WaitForOwnerNameOptions = {},
): Promise<string | null> {
  const configuredAttempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const attempts = Number.isFinite(configuredAttempts)
    ? Math.max(0, Math.floor(configuredAttempts))
    : DEFAULT_ATTEMPTS;
  const configuredInterval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const intervalMs = Number.isFinite(configuredInterval)
    ? Math.max(0, configuredInterval)
    : DEFAULT_INTERVAL_MS;
  const wait = options.wait ?? defaultWait;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.shouldAbort?.()) return null;
    const name = readOwnerName(root);
    if (name) return name;
    if (attempt + 1 < attempts) await wait(intervalMs);
  }
  return null;
}
