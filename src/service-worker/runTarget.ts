import {
  LINKEDIN_FEED_URL,
  LINKEDIN_MATCH_PATTERN,
  isSupportedLinkedInUrl,
} from '@lib/linkedin/urls';
export { LINKEDIN_FEED_URL, LINKEDIN_MATCH_PATTERN };
export { CONTENT_PROTOCOL_VERSION } from '@lib/runtimeProtocol';
import { CONTENT_PROTOCOL_VERSION } from '@lib/runtimeProtocol';
import {
  DOM_CAPABILITY_STATES,
  LINKEDIN_SURFACES,
  type LinkedInDomCapabilities,
  type LinkedInSurface,
} from '@lib/types';

export interface TargetTab {
  id?: number;
  url?: string;
  status?: 'unloaded' | 'loading' | 'complete';
  windowId?: number;
  active?: boolean;
}

export interface ContentPong {
  type: 'PONG';
  protocolVersion: number;
  url: string;
  surface: LinkedInSurface;
  capabilities: LinkedInDomCapabilities;
  activeRunId: string | null;
}

export interface RunTargetDependencies {
  hasHostPermission(): Promise<boolean>;
  queryTabs(query: Record<string, unknown>): Promise<TargetTab[]>;
  createTab(url: string): Promise<TargetTab>;
  updateTab(tabId: number, url: string): Promise<TargetTab>;
  getTab(tabId: number): Promise<TargetTab | null>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
  reloadTab(tabId: number): Promise<void>;
  injectContentScript(tabId: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  maxAttempts?: number;
}

export interface ChromeTabReloadPort {
  reload(tabId: number): Promise<void>;
}

export interface ChromePermissionsPort {
  contains(permissions: { origins: string[] }): Promise<boolean>;
}

/** Production adapter kept explicit so the chrome.tabs.reload boundary is contract-tested. */
export function reloadChromeTab(tabs: ChromeTabReloadPort, tabId: number): Promise<void> {
  return tabs.reload(tabId);
}

export function containsLinkedInHostPermission(
  permissions: ChromePermissionsPort,
): Promise<boolean> {
  return permissions.contains({ origins: [LINKEDIN_MATCH_PATTERN] });
}

export type TargetSelection =
  | { ok: true; tab: TargetTab & { id: number }; created: boolean }
  | { ok: false; reason: 'no-linkedin-tab' | 'missing-host-permission' };

export type FeedPreparation =
  | { ok: true; tabId: number; pong: ContentPong }
  | { ok: false; reason: 'navigation_failed' | 'unsupported_dom' };

export function isLinkedInUrl(url: string | undefined): boolean {
  return isSupportedLinkedInUrl(url);
}

export function isFeedUrl(url: string | undefined): boolean {
  if (typeof url !== 'string' || !isLinkedInUrl(url)) return false;
  const path = new URL(url).pathname.replace(/\/+$/, '');
  return path === '/feed';
}

export async function selectLinkedInTarget(deps: RunTargetDependencies): Promise<TargetSelection> {
  try {
    if (!(await hasLinkedInHostPermission(deps))) {
      return { ok: false, reason: 'missing-host-permission' };
    }
    const activeTabs = await deps.queryTabs({ active: true, lastFocusedWindow: true });
    const active = activeTabs.find(hasLinkedInId);
    if (active) return { ok: true, tab: active, created: false };

    const linkedinTabs = await deps.queryTabs({ url: LINKEDIN_MATCH_PATTERN });
    const existing = linkedinTabs.filter(hasLinkedInId);
    const feed = existing.find((candidate) => isFeedUrl(candidate.url));
    if (feed) return { ok: true, tab: feed, created: false };

    const created = await deps.createTab(LINKEDIN_FEED_URL);
    if (!hasLinkedInId(created)) return { ok: false, reason: 'no-linkedin-tab' };
    return { ok: true, tab: created, created: true };
  } catch {
    return { ok: false, reason: 'no-linkedin-tab' };
  }
}

export async function hasLinkedInHostPermission(deps: RunTargetDependencies): Promise<boolean> {
  try {
    return await deps.hasHostPermission();
  } catch {
    return false;
  }
}

export async function prepareFeedTarget(
  deps: RunTargetDependencies,
  target: TargetTab & { id: number },
  runId: string,
  shouldAbort?: () => boolean | Promise<boolean>,
): Promise<FeedPreparation> {
  if (await aborted(shouldAbort)) return { ok: false, reason: 'navigation_failed' };
  const openFeedUrl = typeof target.url === 'string' && isFeedUrl(target.url) ? target.url : null;
  if (!openFeedUrl) {
    try {
      await deps.updateTab(target.id, LINKEDIN_FEED_URL);
    } catch {
      return { ok: false, reason: 'navigation_failed' };
    }
  }

  const prepared = await waitForRunTarget(
    deps,
    target.id,
    openFeedUrl ?? LINKEDIN_FEED_URL,
    runId,
    true,
    shouldAbort,
  );
  if (!prepared.ok) return prepared;
  if (!feedContractSupported(prepared.pong)) return { ok: false, reason: 'unsupported_dom' };
  return prepared;
}

/** Navigate to one exact route, verify the fresh content protocol, then reserve it for the run. */
export async function prepareRunTarget(
  deps: RunTargetDependencies,
  tabId: number,
  url: string,
  runId: string,
  shouldAbort?: () => boolean | Promise<boolean>,
): Promise<FeedPreparation> {
  const targetUrl = absoluteLinkedInUrl(url);
  if (!targetUrl) return { ok: false, reason: 'navigation_failed' };
  if (await aborted(shouldAbort)) return { ok: false, reason: 'navigation_failed' };
  try {
    await deps.updateTab(tabId, targetUrl);
  } catch {
    return { ok: false, reason: 'navigation_failed' };
  }
  if (await aborted(shouldAbort)) return { ok: false, reason: 'navigation_failed' };
  return waitForRunTarget(deps, tabId, targetUrl, runId, false, shouldAbort);
}

async function waitForRunTarget(
  deps: RunTargetDependencies,
  tabId: number,
  expectedUrl: string,
  runId: string,
  requireFeedReady = false,
  shouldAbort?: () => boolean | Promise<boolean>,
): Promise<FeedPreparation> {
  const maxAttempts = Math.max(1, deps.maxAttempts ?? 30);

  if (!(await waitUntilLoaded(deps, tabId, expectedUrl, maxAttempts, shouldAbort))) {
    return { ok: false, reason: 'navigation_failed' };
  }

  let attemptLimit = maxAttempts;
  let injected = false;
  let reloaded = false;
  let sawStaleProtocol = false;
  const reinjectOnce = async (): Promise<boolean> => {
    if (injected) return true;
    injected = true;
    if (!(await deps.injectContentScript(tabId))) return false;
    attemptLimit += 1; // guarantee one post-injection handshake even when maxAttempts is 1
    return true;
  };
  const reloadOnce = async (): Promise<boolean> => {
    if (reloaded) return true;
    reloaded = true;
    try {
      await deps.reloadTab(tabId);
    } catch {
      return false;
    }
    if (await aborted(shouldAbort)) return false;
    await deps.sleep(500);
    if (!(await waitUntilLoaded(deps, tabId, expectedUrl, maxAttempts, shouldAbort))) return false;
    attemptLimit += 1; // guarantee one handshake with the fresh declarative content script
    return true;
  };
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    if (await aborted(shouldAbort)) return { ok: false, reason: 'navigation_failed' };
    try {
      const response = await deps.sendMessage(tabId, { type: 'PING' });
      if (await aborted(shouldAbort)) return { ok: false, reason: 'navigation_failed' };
      if (isPongLike(response) && !isContentPong(response)) {
        sawStaleProtocol = true;
        if (!injected) {
          if (await reinjectOnce()) {
            await deps.sleep(500);
            continue;
          }
        }
        if (!reloaded) {
          if (!(await reloadOnce())) return { ok: false, reason: 'navigation_failed' };
          await deps.sleep(500);
          continue;
        }
        return { ok: false, reason: 'navigation_failed' };
      }
      if (!isContentPong(response)) return { ok: false, reason: 'unsupported_dom' };
      if (!sameNormalizedRoute(response.url, expectedUrl)) {
        await deps.sleep(500);
        continue;
      }
      if (requireFeedReady && !feedContractSupported(response)) {
        await deps.sleep(500);
        continue;
      }
      if (response.activeRunId && response.activeRunId !== runId) {
        await deps
          .sendMessage(tabId, { type: 'STOP_AUTOPILOT', runId: response.activeRunId })
          .catch(() => undefined);
        await deps.sleep(50);
        continue;
      }
      const attached = await deps.sendMessage(tabId, { type: 'AUTOPILOT_ATTACH', runId });
      if (!isAttachAck(attached, runId)) {
        if (!(await reloadOnce())) return { ok: false, reason: 'navigation_failed' };
        await deps.sleep(500);
        continue;
      }
      if (await aborted(shouldAbort)) {
        await deps.sendMessage(tabId, { type: 'STOP_AUTOPILOT', runId }).catch(() => undefined);
        return { ok: false, reason: 'navigation_failed' };
      }
      return { ok: true, tabId, pong: { ...response, activeRunId: runId } };
    } catch {
      if (!(await reinjectOnce())) return { ok: false, reason: 'unsupported_dom' };
      await deps.sleep(500);
    }
  }
  return { ok: false, reason: sawStaleProtocol ? 'navigation_failed' : 'unsupported_dom' };
}

async function waitUntilLoaded(
  deps: RunTargetDependencies,
  tabId: number,
  expectedUrl: string,
  maxAttempts: number,
  shouldAbort?: () => boolean | Promise<boolean>,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await aborted(shouldAbort)) return false;
    const current = await deps.getTab(tabId).catch(() => null);
    if (await aborted(shouldAbort)) return false;
    if (current?.status === 'complete' && sameNormalizedRoute(current.url, expectedUrl))
      return true;
    await deps.sleep(500);
    if (await aborted(shouldAbort)) return false;
  }
  return false;
}

async function aborted(check?: () => boolean | Promise<boolean>): Promise<boolean> {
  return check ? await check() : false;
}

export function sameNormalizedRoute(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  try {
    const normalize = (value: string) => {
      const parsed = new URL(value, LINKEDIN_FEED_URL);
      const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
      const pairs = [...parsed.searchParams.entries()].sort(
        ([leftKey, leftValue], [rightKey, rightValue]) => {
          if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
          if (leftValue === rightValue) return 0;
          return leftValue < rightValue ? -1 : 1;
        },
      );
      const search = new URLSearchParams(pairs).toString();
      return `${parsed.origin.toLowerCase()}${pathname}${search ? `?${search}` : ''}`;
    };
    return normalize(actual) === normalize(expected);
  } catch {
    return false;
  }
}

function absoluteLinkedInUrl(value: string): string | null {
  try {
    const url = new URL(value, LINKEDIN_FEED_URL);
    return isLinkedInUrl(url.href) ? url.href : null;
  } catch {
    return null;
  }
}

export function isContentPong(value: unknown): value is ContentPong {
  if (!value || typeof value !== 'object') return false;
  const pong = value as Partial<ContentPong>;
  return (
    pong.type === 'PONG' &&
    pong.protocolVersion === CONTENT_PROTOCOL_VERSION &&
    typeof pong.url === 'string' &&
    LINKEDIN_SURFACES.includes(pong.surface as LinkedInSurface) &&
    isDomCapabilities(pong.capabilities) &&
    (pong.activeRunId === null || typeof pong.activeRunId === 'string')
  );
}

function feedContractSupported(pong: ContentPong): boolean {
  return pong.surface === 'feed' && pong.capabilities.feed !== 'unsupported_dom';
}

function isDomCapabilities(value: unknown): value is LinkedInDomCapabilities {
  if (!value || typeof value !== 'object') return false;
  const capabilities = value as Partial<Record<keyof LinkedInDomCapabilities, unknown>>;
  const keys: Array<keyof LinkedInDomCapabilities> = [
    'feed',
    'like',
    'comment',
    'connect',
    'pagination',
    'profile',
    'ssi',
  ];
  return keys.every((key) => DOM_CAPABILITY_STATES.some((state) => state === capabilities[key]));
}

function isPongLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return (value as { type?: unknown }).type === 'PONG';
}

function isAttachAck(value: unknown, runId: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const ack = value as { ok?: unknown; runId?: unknown };
  return ack.ok === true && ack.runId === runId;
}

function hasLinkedInId(tab: TargetTab): tab is TargetTab & { id: number } {
  return typeof tab.id === 'number' && isLinkedInUrl(tab.url);
}
