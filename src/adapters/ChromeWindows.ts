import { LINKEDIN_FEED_URL } from '@lib/linkedin/urls';

/** Thin wrapper over chrome.windows for the autopilot worker window. */
export class ChromeWindows {
  async createFeedWindow(): Promise<{ windowId: number; tabId: number }> {
    const win = await chrome.windows.create({
      url: LINKEDIN_FEED_URL,
      focused: false,
      width: 900,
      height: 800,
    });
    const tab = win.tabs?.[0];
    return { windowId: win.id ?? -1, tabId: tab?.id ?? -1 };
  }

  async close(windowId: number): Promise<void> {
    await chrome.windows.remove(windowId).catch(() => {});
  }
}
