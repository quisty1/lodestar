import type { LodestarMessage } from '@lib/types';

/**
 * Thin wrapper over chrome.runtime for the side panel. Guards the non-extension
 * context (unit tests / plain browser) so components stay testable.
 */
export const panelBus = {
  available(): boolean {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  },

  send(message: LodestarMessage): void {
    if (!this.available()) return;
    chrome.runtime.sendMessage(message).catch(() => {});
  },

  /** Send and await the SW's sendResponse payload (null outside the extension). */
  async request<T>(message: LodestarMessage): Promise<T | null> {
    if (!this.available()) return null;
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return null;
    }
  },

  onMessage(handler: (message: LodestarMessage) => void): () => void {
    if (!this.available()) return () => {};
    const listener = (message: LodestarMessage) => {
      handler(message);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  },
};
