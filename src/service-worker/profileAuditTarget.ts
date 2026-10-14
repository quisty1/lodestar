import { LINKEDIN_ORIGIN, isSupportedLinkedInUrl } from '@lib/linkedin/urls';
import { isContentPong } from './runTarget';

export const LINKEDIN_PROFILE_ME_URL = `${LINKEDIN_ORIGIN}/in/me/`;

export interface ProfileAuditTab {
  id?: number;
  url?: string;
  status?: 'unloaded' | 'loading' | 'complete';
  active?: boolean;
  windowId?: number;
}

export interface ProfileAuditTargetDependencies {
  hasHostPermission(): Promise<boolean>;
  queryTabs(query: Record<string, unknown>): Promise<ProfileAuditTab[]>;
  updateTab(tabId: number, url: string): Promise<ProfileAuditTab>;
  getTab(tabId: number): Promise<ProfileAuditTab | null>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
  reloadTab(tabId: number): Promise<void>;
  injectContentScript(tabId: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  maxAttempts?: number;
}

export type ProfileAuditTargetResult =
  | { ok: true; tabId: number; profileUrl: string }
  | {
      ok: false;
      reason:
        | 'missing-host-permission'
        | 'no-linkedin-tab'
        | 'navigation-failed'
        | 'not-authenticated'
        | 'unsupported-dom';
    };

export async function prepareProfileAuditTarget(
  deps: ProfileAuditTargetDependencies,
): Promise<ProfileAuditTargetResult> {
  if (!(await hasPermission(deps))) return { ok: false, reason: 'missing-host-permission' };
  const active = await activeLinkedInTab(deps);
  if (!active) return { ok: false, reason: 'no-linkedin-tab' };

  if (!isSelfProfileUrl(active.url)) {
    try {
      await deps.updateTab(active.id, LINKEDIN_PROFILE_ME_URL);
    } catch {
      return { ok: false, reason: 'navigation-failed' };
    }
  }

  const loaded = await waitForSelfProfile(deps, active.id);
  if (!loaded.ok) return loaded;
  return waitForProfileReader(deps, active.id, loaded.profileUrl);
}

async function hasPermission(deps: ProfileAuditTargetDependencies): Promise<boolean> {
  try {
    return await deps.hasHostPermission();
  } catch {
    return false;
  }
}

async function activeLinkedInTab(
  deps: ProfileAuditTargetDependencies,
): Promise<(ProfileAuditTab & { id: number }) | null> {
  try {
    const tabs = await deps.queryTabs({ active: true, lastFocusedWindow: true });
    return (
      tabs.find(
        (tab): tab is ProfileAuditTab & { id: number } =>
          typeof tab.id === 'number' && isSupportedLinkedInUrl(tab.url),
      ) ?? null
    );
  } catch {
    return null;
  }
}

async function waitForSelfProfile(
  deps: ProfileAuditTargetDependencies,
  tabId: number,
): Promise<
  | { ok: true; profileUrl: string }
  | { ok: false; reason: 'navigation-failed' | 'not-authenticated' }
> {
  const attempts = Math.max(1, deps.maxAttempts ?? 30);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const tab = await deps.getTab(tabId).catch(() => null);
    if (isAuthenticationUrl(tab?.url)) return { ok: false, reason: 'not-authenticated' };
    const profileUrl = tab?.url;
    if (tab?.status === 'complete' && profileUrl && isSelfProfileUrl(profileUrl))
      return { ok: true, profileUrl };
    if (attempt + 1 < attempts) await deps.sleep(500);
  }
  return { ok: false, reason: 'navigation-failed' };
}

async function waitForProfileReader(
  deps: ProfileAuditTargetDependencies,
  tabId: number,
  profileUrl: string,
): Promise<ProfileAuditTargetResult> {
  const attempts = Math.max(1, deps.maxAttempts ?? 30);
  let limit = attempts;
  let injected = false;
  let reloaded = false;

  for (let attempt = 0; attempt < limit; attempt += 1) {
    try {
      const pong = await deps.sendMessage(tabId, { type: 'PING' });
      if (isPongLike(pong) && !isContentPong(pong)) {
        if (reloaded) return { ok: false, reason: 'unsupported-dom' };
        reloaded = true;
        try {
          await deps.reloadTab(tabId);
        } catch {
          return { ok: false, reason: 'navigation-failed' };
        }
        const loaded = await waitForSelfProfile(deps, tabId);
        if (!loaded.ok) return loaded;
        profileUrl = loaded.profileUrl;
        limit += 1;
        continue;
      }
      if (
        isContentPong(pong) &&
        sameProfile(pong.url, profileUrl) &&
        pong.surface === 'profile' &&
        pong.capabilities.profile === 'ready'
      ) {
        return { ok: true, tabId, profileUrl };
      }
    } catch {
      if (injected) return { ok: false, reason: 'unsupported-dom' };
      injected = true;
      if (!(await deps.injectContentScript(tabId))) return { ok: false, reason: 'unsupported-dom' };
      limit += 1;
    }
    if (attempt + 1 < limit) await deps.sleep(500);
  }
  return { ok: false, reason: 'unsupported-dom' };
}

function isSelfProfileUrl(value: string | undefined): boolean {
  if (typeof value !== 'string' || !isSupportedLinkedInUrl(value)) return false;
  const url = new URL(value);
  const parts = url.pathname.split('/').filter(Boolean);
  return (
    parts[0] === 'in' &&
    Boolean(parts[1] && parts[1] !== 'me') &&
    url.searchParams.get('isSelfProfile') === 'true'
  );
}

function isAuthenticationUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.origin === LINKEDIN_ORIGIN && /^\/(login|authwall|checkpoint)(\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function sameProfile(actual: string, expected: string): boolean {
  try {
    return (
      new URL(actual).pathname.replace(/\/+$/, '') ===
      new URL(expected).pathname.replace(/\/+$/, '')
    );
  } catch {
    return false;
  }
}

function isPongLike(value: unknown): value is { type: 'PONG' } {
  return (
    typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'PONG'
  );
}
