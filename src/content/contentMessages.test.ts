import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LodestarMessage } from '@lib/types';
import { registerContentMessages } from './contentMessages';
import { harvestByScrolling } from './feedHarvest';
import { hideActivity, showActivity } from './activityOverlay';
import { parseAndReport } from './ssiPage';
import { send } from './contentTiming';

vi.mock('./feedHarvest', () => ({
  harvestByScrolling: vi.fn(async () => [{ urn: 'urn:li:activity:1' }]),
  harvestPeopleMessage: vi.fn(async () => ({ candidates: [], outcome: 'not_ready' })),
  harvestProfilesMessage: vi.fn(async () => ({ candidates: [], outcome: 'not_ready' })),
  goToNextPeoplePage: vi.fn(async () => false),
  harvestPymkMessage: vi.fn(async () => ({ candidates: [], outcome: 'not_ready' })),
}));

vi.mock('./ssiPage', () => ({
  parseAndReport: vi.fn(),
}));

vi.mock('./activityOverlay', () => ({
  showActivity: vi.fn(),
  hideActivity: vi.fn(),
}));

vi.mock('./contentTiming', () => ({
  send: vi.fn(),
}));

type Listener = (
  message: LodestarMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

let listener: Listener;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener(next: Listener) {
          listener = next;
        },
      },
    },
  });
  registerContentMessages({
    parser: {} as never,
    source: {} as never,
    feed: {
      parse: () => [{ urn: 'urn:li:activity:9', authorName: 'Ada', text: 'hello' }],
    } as never,
    delay: {} as never,
  });
});

describe('registerContentMessages', () => {
  it('reports SSI and a static harvest without taking the response channel', () => {
    const sendResponse = vi.fn();
    expect(listener({ type: 'REQUEST_SSI' }, {}, sendResponse)).toBe(false);
    expect(parseAndReport).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });

    expect(listener({ type: 'REQUEST_FEED_HARVEST', limit: 5 }, {}, sendResponse)).toBe(false);
    expect(send).toHaveBeenCalledWith({
      type: 'FEED_ITEMS',
      payload: [{ id: 'urn:li:activity:9', author: 'Ada', excerpt: 'hello' }],
    });
  });

  it('keeps the channel open for a scrolling harvest and ignores sync traffic', async () => {
    const sendResponse = vi.fn();
    expect(listener({ type: 'REQUEST_FEED_POSTS', limit: 3 }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });
    expect(harvestByScrolling).toHaveBeenCalled();

    const ignored = vi.fn();
    expect(listener({ type: 'PING' }, {}, ignored)).toBe(false);
    expect(ignored).not.toHaveBeenCalled();
  });

  it('shows and hides the activity overlay', () => {
    const sendResponse = vi.fn();
    listener({ type: 'SET_ACTIVITY', active: true, label: 'Сканирую' }, {}, sendResponse);
    expect(showActivity).toHaveBeenCalledWith(document, 'Сканирую');
    listener({ type: 'SET_ACTIVITY', active: false }, {}, sendResponse);
    expect(hideActivity).toHaveBeenCalled();
  });

  it('throws on an unknown message type', () => {
    expect(() =>
      listener({ type: 'NOT_A_MESSAGE' } as unknown as LodestarMessage, {}, vi.fn()),
    ).toThrow(/Unhandled message variant/);
  });
});
