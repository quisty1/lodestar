import type { LodestarMessage, FeedPost } from '@lib/types';
import {
  isContentPong,
  LINKEDIN_MATCH_PATTERN,
  prepareRunTarget,
  sameNormalizedRoute,
  type RunTargetDependencies,
} from './runTarget';

export async function readTabMessage(tabId: number, message: object): Promise<unknown> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as unknown;
  } catch {
    return null;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function broadcast(message: LodestarMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

export function notify(title: string, message: string): void {
  const iconUrl = chrome.runtime.getURL('icons/icon-128.png');
  if (!chrome.notifications?.create) return;
  chrome.notifications.create({
    type: 'basic',
    iconUrl,
    title,
    message,
  });
}

export async function reinjectContentScript(tabId: number): Promise<boolean> {
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js;
  if (!files?.length) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
    return true;
  } catch {
    return false;
  }
}

export async function activeLinkedInTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ url: LINKEDIN_MATCH_PATTERN });
  return tabs.find((t) => (t.url ?? '').includes('/feed')) ?? tabs[0];
}

export async function forwardToLinkedInTab(message: LodestarMessage): Promise<void> {
  const tab = await activeLinkedInTab();
  if (tab?.id) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
}

export async function sendToLinkedInTab<T>(message: LodestarMessage): Promise<T | undefined> {
  const tab = await activeLinkedInTab();
  if (!tab?.id) return undefined;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    if (!(await reinjectContentScript(tab.id))) return undefined;
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      return undefined;
    }
  }
}

export async function withPageActivity<T>(op: () => Promise<T>, label: string): Promise<T> {
  void forwardToLinkedInTab({ type: 'SET_ACTIVITY', active: true, label });
  try {
    return await op();
  } finally {
    void forwardToLinkedInTab({ type: 'SET_ACTIVITY', active: false });
  }
}

export async function harvestPosts(limit: number): Promise<FeedPost[]> {
  return (
    (await sendToLinkedInTab<FeedPost[]>({
      type: 'REQUEST_FEED_POSTS',
      limit,
    })) ?? []
  );
}

export async function setStage(
  coordinator: { setStage(runId: string, label: string): Promise<unknown> },
  runId: string,
  tabId: number | undefined,
  label: string,
): Promise<void> {
  const state = await coordinator.setStage(runId, label);
  if (!state) return;
  if (tabId)
    await chrome.tabs
      .sendMessage(tabId, { type: 'SET_ACTIVITY', active: true, label })
      .catch(() => undefined);
  broadcast({ type: 'AUTOPILOT_STAGE', runId, label });
}

/**
 * Navigate the LinkedIn tab and wait until the NEW page is actually loaded + its content
 * script answers. Waiting for PING alone races: during the transition the OLD page's
 * content script answers immediately.
 */
export async function navigateLinkedInTab(
  targetDeps: RunTargetDependencies,
  isActive: (runId: string) => Promise<boolean>,
  tabId: number,
  url: string,
  runId?: string,
): Promise<boolean> {
  if (runId) {
    const prepared = await prepareRunTarget(targetDeps, tabId, url, runId, () =>
      isActive(runId).then((active) => !active),
    );
    if (!prepared.ok) return false;
    if (await isActive(runId)) return true;
    await chrome.tabs.sendMessage(tabId, { type: 'STOP_AUTOPILOT', runId }).catch(() => undefined);
    return false;
  }
  await chrome.tabs.update(tabId, { url });
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || tab.status !== 'complete' || !sameNormalizedRoute(tab.url, url)) continue;
    const pong = await readTabMessage(tabId, { type: 'PING' });
    if (isContentPong(pong) && sameNormalizedRoute(pong.url, url)) return true;
  }
  return false;
}
