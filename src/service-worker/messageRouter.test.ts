import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LodestarMessage, SsiSnapshot } from '@lib/types';
import { registerServiceWorkerMessages } from './messageRouter';
import { broadcast, forwardToLinkedInTab, withPageActivity } from './linkedinTabBridge';
import * as content from './contentHandlers';
import { recordComment, refreshInbound } from './productSignals';
import type { WorkerContext } from './workerContext';

vi.mock('./linkedinTabBridge', () => ({
  broadcast: vi.fn(),
  forwardToLinkedInTab: vi.fn(async () => {}),
  harvestPosts: vi.fn(async () => []),
  withPageActivity: vi.fn(async (op: () => Promise<unknown>) => op()),
}));

vi.mock('./contentHandlers', () => ({
  generateDraft: vi.fn(async () => ({ draft: { id: 'd1' } })),
  generateIdeas: vi.fn(async () => ({ ideas: [] })),
}));

vi.mock('./productSignals', () => ({
  recordComment: vi.fn(async () => {}),
  refreshInbound: vi.fn(async () => ({ capturedAt: '2026-10-08T00:00:00.000Z' })),
}));

type Listener = (
  message: LodestarMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

let listener: Listener;
let ctx: WorkerContext;

const snapshot: SsiSnapshot = {
  total: 40,
  capturedAt: '2026-10-08T00:00:00.000Z',
  pillars: [
    { key: 'brand', label: 'Brand', score: 10 },
    { key: 'people', label: 'People', score: 10 },
    { key: 'insights', label: 'Insights', score: 10 },
    { key: 'relationships', label: 'Relationships', score: 10 },
  ],
};

function context(): WorkerContext {
  return {
    repo: { save: vi.fn(async () => {}) },
    store: {},
    reportsStore: { list: vi.fn(async () => []) },
    refreshMetricsIfDue: vi.fn(),
    clock: { now: () => new Date('2026-10-08T00:00:00.000Z') },
    llmHttp: {},
  } as unknown as WorkerContext;
}

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
  ctx = context();
  registerServiceWorkerMessages(ctx);
});

describe('registerServiceWorkerMessages', () => {
  it('keeps the channel for async work and answers after the handler', async () => {
    const sendResponse = vi.fn();
    expect(listener({ type: 'SSI_SNAPSHOT', payload: snapshot }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });
    expect(ctx.repo.save).toHaveBeenCalledWith(snapshot);
    expect(broadcast).toHaveBeenCalledWith({ type: 'SSI_SNAPSHOT', payload: snapshot });

    const draftResponse = vi.fn();
    expect(
      listener({ type: 'GENERATE_DRAFT', idea: { topic: 't', angle: 'a' } }, {}, draftResponse),
    ).toBe(true);
    await vi.waitFor(() => {
      expect(draftResponse).toHaveBeenCalled();
    });
    expect(content.generateDraft).toHaveBeenCalled();

    const ideasResponse = vi.fn();
    expect(listener({ type: 'GENERATE_IDEAS' }, {}, ideasResponse)).toBe(true);
    await vi.waitFor(() => {
      expect(ideasResponse).toHaveBeenCalled();
    });
    expect(withPageActivity).toHaveBeenCalled();
    expect(content.generateIdeas).toHaveBeenCalled();

    const commentResponse = vi.fn();
    const entry = {
      id: 'c1',
      text: 'hi',
      author: 'Ada',
      postUrn: 'urn:1',
      at: '2026-10-08T00:00:00.000Z',
    };
    expect(listener({ type: 'RECORD_COMMENT', entry }, {}, commentResponse)).toBe(true);
    await vi.waitFor(() => {
      expect(commentResponse).toHaveBeenCalledWith({ ok: true });
    });
    expect(recordComment).toHaveBeenCalledWith(expect.anything(), entry);
  });

  it('answers null when inbound refresh fails', async () => {
    vi.mocked(refreshInbound).mockRejectedValueOnce(new Error('disk'));
    const sendResponse = vi.fn();
    expect(listener({ type: 'REFRESH_INBOUND' }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(null);
    });
  });

  it('does not answer sync messages itself', () => {
    const sendResponse = vi.fn();
    expect(listener({ type: 'PING' }, {}, sendResponse)).toBe(false);
    expect(listener({ type: 'REQUEST_SSI' }, {}, sendResponse)).toBe(false);
    expect(forwardToLinkedInTab).toHaveBeenCalledWith({ type: 'REQUEST_SSI' });
    expect(listener({ type: 'START_AUTOPILOT', host: 'tab' }, {}, sendResponse)).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
