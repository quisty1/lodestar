import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedPost } from '@lib/types';
import type { HumanDelay } from '@lib/engagement/HumanDelay';
import { ContentRunSession } from './runSession';
import { commentAfterLike } from './feedCommentStep';
import { executeComment } from './domActions';
import { ask } from './contentTiming';

vi.mock('./contentTiming', () => ({
  ask: vi.fn(),
}));

vi.mock('./domActions', () => ({
  executeComment: vi.fn(),
}));

vi.mock('./activityOverlay', () => ({
  countdownActivity: vi.fn(),
}));

const post: FeedPost = { urn: 'urn:li:activity:1', authorName: 'Ada', text: 'hello' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('commentAfterLike', () => {
  it('does not comment when the page returns no text', async () => {
    vi.mocked(ask).mockResolvedValue({ ok: false });
    const session = new ContentRunSession();
    session.begin('run-1');
    const commented = await commentAfterLike({
      runId: 'run-1',
      post,
      runSession: session,
      effectClient: { execute: vi.fn() } as never,
      delay: {} as HumanDelay,
      endRun: vi.fn(async () => {}),
      commentedThisRun: false,
    });
    expect(commented).toBe(false);
    expect(executeComment).not.toHaveBeenCalled();
  });

  it('drops the reply when the run is already aborted', async () => {
    vi.mocked(ask).mockResolvedValue({ ok: true, text: 'nice' });
    const session = new ContentRunSession();
    const commented = await commentAfterLike({
      runId: 'run-1',
      post,
      runSession: session,
      effectClient: { execute: vi.fn() } as never,
      delay: {} as HumanDelay,
      endRun: vi.fn(async () => {}),
      commentedThisRun: false,
    });
    expect(commented).toBe(false);
    expect(executeComment).not.toHaveBeenCalled();
  });
});
