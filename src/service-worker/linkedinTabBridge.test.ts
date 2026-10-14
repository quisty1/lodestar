import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  harvestPosts,
  readTabMessage,
  reinjectContentScript,
  sendToLinkedInTab,
  withPageActivity,
} from './linkedinTabBridge';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('linkedinTabBridge', () => {
  it('does nothing when no LinkedIn tab is open', async () => {
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn(async () => []), sendMessage },
    });
    await expect(sendToLinkedInTab({ type: 'PING' })).resolves.toBeUndefined();
    await expect(harvestPosts(5)).resolves.toEqual([]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reinjects the content script and retries the message', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('no receiver'))
      .mockResolvedValueOnce({ ok: true });
    const executeScript = vi.fn(async () => []);
    vi.stubGlobal('chrome', {
      runtime: { getManifest: () => ({ content_scripts: [{ js: ['content.js'] }] }) },
      tabs: {
        query: vi.fn(async () => [{ id: 7, url: 'https://www.linkedin.com/feed/' }]),
        sendMessage,
      },
      scripting: { executeScript },
    });
    await expect(sendToLinkedInTab({ type: 'PING' })).resolves.toEqual({ ok: true });
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ['content.js'] });
  });

  it('stops when reinjection fails', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('no receiver'));
    vi.stubGlobal('chrome', {
      runtime: { getManifest: () => ({ content_scripts: [{ js: ['content.js'] }] }) },
      tabs: {
        query: vi.fn(async () => [{ id: 7, url: 'https://www.linkedin.com/feed/' }]),
        sendMessage,
      },
      scripting: { executeScript: vi.fn(async () => Promise.reject(new Error('denied'))) },
    });
    await expect(sendToLinkedInTab({ type: 'PING' })).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledOnce();
    await expect(reinjectContentScript(7)).resolves.toBe(false);
  });

  it('shows page activity and hides it even when the operation throws', async () => {
    const sendMessage = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn(async () => undefined) },
      tabs: {
        query: vi.fn(async () => [{ id: 7, url: 'https://www.linkedin.com/feed/' }]),
        sendMessage,
      },
    });
    await expect(withPageActivity(async () => 5, 'Идеи')).resolves.toBe(5);
    await expect(
      withPageActivity(async () => Promise.reject(new Error('boom')), 'Идеи'),
    ).rejects.toThrow('boom');
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(7, {
        type: 'SET_ACTIVITY',
        active: true,
        label: 'Идеи',
      });
    });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'SET_ACTIVITY', active: false });
  });

  it('returns null when the tab message throws', async () => {
    vi.stubGlobal('chrome', {
      tabs: { sendMessage: vi.fn(async () => Promise.reject(new Error('gone'))) },
    });
    await expect(readTabMessage(3, { type: 'PING' })).resolves.toBeNull();
  });
});
