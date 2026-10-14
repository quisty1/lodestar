import { describe, expect, it, vi } from 'vitest';
import type { AutopilotState, FeedPost } from '@lib/types';
import {
  permitsFinishedIdeaCatchup,
  registerRunContentRuntime,
  type RunContentRuntimeDependencies,
} from './runContentRuntime';

const POST: FeedPost = {
  urn: 'urn:li:activity:1',
  authorName: 'Anna',
  text: 'Vue architecture',
};

function deferred<T>() {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next as (value?: T | PromiseLike<T>) => void;
  });
  return { promise, resolve };
}

function captureListener(dependencies: RunContentRuntimeDependencies) {
  let listener!: (
    message: unknown,
    sender: unknown,
    sendResponse: (response: unknown) => void,
  ) => boolean;
  registerRunContentRuntime(
    {
      addListener: (registered) => {
        listener = registered;
      },
    },
    dependencies,
  );
  return listener;
}

function baseDependencies(): RunContentRuntimeDependencies {
  return {
    isActive: async (runId) => runId === 'run-1',
    canExtract: async (runId) => runId === 'run-1',
    showIdeaActivity: vi.fn(async () => undefined),
    hideIdeaActivity: vi.fn(async () => undefined),
    extract: vi.fn(async () => ({ stored: 1 })),
    comment: vi.fn(async () => ({ ok: true, text: 'Specific take' })),
  };
}

describe('registerRunContentRuntime listener boundary', () => {
  it.each([
    ['EXTRACT_RUN_IDEAS', { type: 'EXTRACT_RUN_IDEAS', posts: [POST] }],
    ['COMMENT_ON_POST', { type: 'COMMENT_ON_POST', post: POST }],
  ])('rejects unscoped %s messages at the production callback', async (_type, message) => {
    const dependencies = baseDependencies();
    const listener = captureListener(dependencies);
    const response = deferred<unknown>();

    expect(listener(message, {}, response.resolve)).toBe(true);
    await expect(response.promise).resolves.toMatchObject({ reason: 'run-inactive' });
    expect(dependencies.extract).not.toHaveBeenCalled();
    expect(dependencies.comment).not.toHaveBeenCalled();
  });

  it('rejects malformed extraction posts before the LLM handler', async () => {
    const dependencies = baseDependencies();
    const listener = captureListener(dependencies);
    const response = deferred<unknown>();

    listener(
      { type: 'EXTRACT_RUN_IDEAS', runId: 'run-1', posts: [{ urn: 'urn:1' }] },
      {},
      response.resolve,
    );

    await expect(response.promise).resolves.toEqual({ stored: 0, error: 'invalid-message' });
    expect(dependencies.extract).not.toHaveBeenCalled();
  });

  it('routes COMMENT_ON_POST through the registered listener with a live run guard', async () => {
    const dependencies = baseDependencies();
    const listener = captureListener(dependencies);
    const response = deferred<unknown>();

    expect(
      listener({ type: 'COMMENT_ON_POST', runId: 'run-1', post: POST }, {}, response.resolve),
    ).toBe(true);
    await expect(response.promise).resolves.toEqual({ ok: true, text: 'Specific take' });
    expect(dependencies.comment).toHaveBeenCalledOnce();
    const cancelled = vi.mocked(dependencies.comment).mock.calls[0][2];
    await expect(cancelled()).resolves.toBe(false);
  });

  it('settles a naturally-finished run without re-lighting page activity', async () => {
    const dependencies = baseDependencies();
    dependencies.isActive = async () => false;
    dependencies.canExtract = async (runId) => runId === 'run-1';
    const listener = captureListener(dependencies);
    const response = deferred<unknown>();

    expect(
      listener({ type: 'EXTRACT_RUN_IDEAS', runId: 'run-1', posts: [POST] }, {}, response.resolve),
    ).toBe(true);

    await expect(response.promise).resolves.toEqual({ stored: 1 });
    expect(dependencies.extract).toHaveBeenCalledOnce();
    expect(dependencies.showIdeaActivity).not.toHaveBeenCalled();
    expect(dependencies.hideIdeaActivity).not.toHaveBeenCalled();
  });

  it.each(['stop', 'new-run'] as const)(
    'drops deferred idea results after %s without stale storage or activity teardown',
    async (transition) => {
      let currentRunId = 'run-1';
      let active = true;
      const llmStarted = deferred<undefined>();
      const llmCompletion = deferred<undefined>();
      const stored = vi.fn();
      const dependencies = baseDependencies();
      dependencies.isActive = async (runId) => active && currentRunId === runId;
      dependencies.canExtract = async (runId) => currentRunId === runId && active;
      dependencies.extract = vi.fn(async (_runId, _posts, cancelled) => {
        llmStarted.resolve();
        await llmCompletion.promise;
        if (await cancelled()) return { stored: 0, error: 'cancelled' };
        stored();
        return { stored: 1 };
      });
      const listener = captureListener(dependencies);
      const response = deferred<unknown>();

      expect(
        listener(
          { type: 'EXTRACT_RUN_IDEAS', runId: 'run-1', posts: [POST] },
          {},
          response.resolve,
        ),
      ).toBe(true);
      await llmStarted.promise;
      if (transition === 'stop') active = false;
      else currentRunId = 'run-2';
      llmCompletion.resolve();

      await expect(response.promise).resolves.toEqual({ stored: 0, error: 'cancelled' });
      expect(stored).not.toHaveBeenCalled();
      expect(dependencies.showIdeaActivity).toHaveBeenCalledWith('run-1');
      expect(dependencies.hideIdeaActivity).not.toHaveBeenCalled();
    },
  );

  it('does not reclassify an in-flight active extraction as a natural-finish catch-up', async () => {
    let active = true;
    let naturalFinish = false;
    const llmStarted = deferred<undefined>();
    const llmCompletion = deferred<undefined>();
    const stored = vi.fn();
    const dependencies = baseDependencies();
    dependencies.isActive = async (runId) => runId === 'run-1' && active;
    dependencies.canExtract = async (runId) => runId === 'run-1' && (active || naturalFinish);
    dependencies.extract = vi.fn(async (_runId, _posts, cancelled) => {
      llmStarted.resolve();
      await llmCompletion.promise;
      if (await cancelled()) return { stored: 0, error: 'cancelled' };
      stored();
      return { stored: 1 };
    });
    const listener = captureListener(dependencies);
    const response = deferred<unknown>();

    listener({ type: 'EXTRACT_RUN_IDEAS', runId: 'run-1', posts: [POST] }, {}, response.resolve);
    await llmStarted.promise;
    active = false;
    naturalFinish = true;
    llmCompletion.resolve();

    await expect(response.promise).resolves.toEqual({ stored: 0, error: 'cancelled' });
    expect(stored).not.toHaveBeenCalled();
    expect(dependencies.hideIdeaActivity).not.toHaveBeenCalled();
  });

  it('allows only the same naturally-finished run to settle buffered ideas', () => {
    const state = {
      running: false,
      host: 'tab',
      day: '2026-08-11',
      used: 0,
      ceiling: 25,
      startedAt: '2026-08-11T10:00:00.000Z',
      actionTimestamps: [],
      actionsSinceBreak: 0,
      manualStop: false,
      runId: 'run-1',
      phase: 'finished',
      stopReason: 'feed_exhausted',
    } satisfies AutopilotState;

    expect(permitsFinishedIdeaCatchup(state, 'run-1')).toBe(true);
    expect(permitsFinishedIdeaCatchup({ ...state, stopReason: 'manual' }, 'run-1')).toBe(false);
    expect(permitsFinishedIdeaCatchup({ ...state, runId: 'run-2' }, 'run-1')).toBe(false);
  });
});
