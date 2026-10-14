import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HumanDelay } from '@lib/engagement/HumanDelay';
import { ContentRunSession } from './runSession';
import { detectRisk, endRun, runAutopilotLoop } from './autopilotFeedLoop';
import { harvestByScrolling } from './feedHarvest';
import { ask } from './contentTiming';

vi.mock('./feedHarvest', () => ({
  harvestByScrolling: vi.fn(),
}));

vi.mock('./contentTiming', () => ({
  ask: vi.fn(async () => undefined),
}));

vi.mock('./activityOverlay', () => ({
  showActivity: vi.fn(),
  setActivityLabel: vi.fn(),
  countdownActivity: vi.fn(),
  clearActivity: vi.fn(),
}));

vi.mock('./domActions', () => ({
  executeLikeEffect: vi.fn(),
}));

vi.mock('./feedCommentStep', () => ({
  commentAfterLike: vi.fn(),
}));

beforeEach(() => {
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/feed/');
  vi.clearAllMocks();
});

describe('detectRisk', () => {
  it('reports captcha, a checkpoint, or a clear page', () => {
    expect(detectRisk()).toBeNull();
    document.body.innerHTML = '<iframe src="https://example.test/captcha"></iframe>';
    expect(detectRisk()).toBe('captcha');
    document.body.innerHTML = '';
    window.history.pushState({}, '', '/checkpoint/challenge');
    expect(detectRisk()).toBe('challenge');
  });
});

describe('runAutopilotLoop', () => {
  it('stops after the session is aborted during the first harvest', async () => {
    const session = new ContentRunSession();
    session.begin('run-1');
    vi.mocked(harvestByScrolling).mockImplementation(async () => {
      session.finish('run-1');
      return [];
    });
    await runAutopilotLoop(deps(session), 'run-1', {
      engagement: false,
      content: false,
      comments: false,
    });
    expect(harvestByScrolling).toHaveBeenCalledOnce();
    expect(session.isActive('run-1')).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('ends the run when harvesting throws', async () => {
    const session = new ContentRunSession();
    session.begin('run-1');
    vi.mocked(harvestByScrolling).mockRejectedValue(new Error('parse failed'));
    await runAutopilotLoop(deps(session), 'run-1', {
      engagement: false,
      content: false,
      comments: false,
    });
    expect(ask).toHaveBeenCalledWith({
      type: 'AUTOPILOT_ENDED',
      runId: 'run-1',
      reason: 'error',
    });
    expect(session.isActive('run-1')).toBe(false);
  });
});

describe('endRun', () => {
  it('closes the session and reports the reason', async () => {
    const session = new ContentRunSession();
    session.begin('run-1');
    await endRun(session, 'run-1', 'manual');
    expect(session.isActive('run-1')).toBe(false);
    expect(ask).toHaveBeenCalledWith({ type: 'AUTOPILOT_ENDED', runId: 'run-1', reason: 'manual' });
  });
});

function deps(session: ContentRunSession) {
  return {
    runSession: session,
    effectClient: { execute: vi.fn() } as never,
    likeFilter: { select: () => ({ likeable: [] }) } as never,
    humanBreak: { nextBreakMs: () => 0 } as never,
    commentRng: { next: () => 0 } as never,
    delay: {} as HumanDelay,
    feed: { parse: () => [] } as never,
  };
}
