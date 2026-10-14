import { describe, expect, it, vi } from 'vitest';
import { ContentRunSession } from './runSession';
import type { LodestarMessage } from '@lib/types';
import { EffectRuntimeClient } from './EffectRuntimeClient';
import { effectMatchesAction } from './effectAction';
import {
  registerScopedContentActionRuntime,
  type ScopedContentActionDependencies,
} from './scopedActionRuntime';

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined;

function deferred<T>() {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next as (value?: T | PromiseLike<T>) => void;
  });
  return { promise, resolve };
}

function setup(overrides: Partial<ScopedContentActionDependencies> = {}) {
  let listener: Listener | undefined;
  const event = {
    addListener: vi.fn((next: Listener) => {
      listener = next;
    }),
  };
  const session = new ContentRunSession();
  session.attach('run-1');
  const dependencies: ScopedContentActionDependencies = {
    session,
    currentUrl: () => 'https://www.linkedin.com/in/al/',
    acceptIncoming: vi.fn(async () => ({ accepted: 0 })),
    executeAction: vi.fn(async () => ({ ok: true })),
    dwell: vi.fn(async () => ({ ok: true })),
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
  registerScopedContentActionRuntime(event, dependencies);
  if (!listener) throw new Error('listener not registered');
  const dispatch = (message: unknown) =>
    new Promise<{ returned: boolean | undefined; response: unknown }>((resolve) => {
      // The response callback can run before listener returns, so this binding stays a let.
      let returned: boolean | undefined;
      // eslint-disable-next-line prefer-const
      returned = listener!(message, {}, (response) => {
        resolve({ returned, response });
      });
    });
  return { session, dependencies, dispatch };
}

describe('scoped content action runtime boundary', () => {
  it('rejects mismatched runId before SLEEP, DWELL, accept or DOM action starts', async () => {
    const { dependencies, dispatch } = setup();
    const messages = [
      { type: 'SLEEP', ms: 30_000, runId: 'old-run' },
      {
        type: 'DWELL_PROFILE',
        runId: 'old-run',
        expectedUrl: 'https://www.linkedin.com/in/al/',
      },
      { type: 'ACCEPT_INCOMING', cap: 15, runId: 'old-run' },
      {
        type: 'EXECUTE_ACTION',
        runId: 'old-run',
        action: { type: 'post', target: { url: '/feed/' } },
      },
    ];

    for (const message of messages) {
      expect((await dispatch(message)).response).toEqual({
        ok: false,
        cancelled: true,
        reason: 'run-inactive',
      });
    }
    expect(dependencies.sleep).not.toHaveBeenCalled();
    expect(dependencies.dwell).not.toHaveBeenCalled();
    expect(dependencies.acceptIncoming).not.toHaveBeenCalled();
    expect(dependencies.executeAction).not.toHaveBeenCalled();
  });

  it('aborts an in-flight SLEEP promptly after scoped STOP and reports cancellation', async () => {
    vi.useFakeTimers();
    try {
      const { session, dependencies, dispatch } = setup({
        sleep: vi.fn(async (_ms, shouldAbort) => {
          while (!shouldAbort()) await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }),
      });
      const response = dispatch({ type: 'SLEEP', ms: 45_000, runId: 'run-1' });

      session.stop('run-1');
      await vi.advanceTimersByTimeAsync(100);

      expect((await response).response).toEqual({
        ok: false,
        cancelled: true,
        reason: 'run-inactive',
      });
      expect(dependencies.sleep).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('validates the exact expected profile URL before dwelling', async () => {
    const { dependencies, dispatch } = setup({
      currentUrl: () => 'https://www.linkedin.com/in/alex/',
    });

    expect(
      (
        await dispatch({
          type: 'DWELL_PROFILE',
          runId: 'run-1',
          expectedUrl: 'https://www.linkedin.com/in/al/',
        })
      ).response,
    ).toEqual({ ok: false, reason: 'wrong-page' });
    expect(dependencies.dwell).not.toHaveBeenCalled();
  });

  it('does not start a deferred DOM action after STOP wins before dispatch', async () => {
    const gate = deferred<undefined>();
    const { session, dependencies, dispatch } = setup({
      executeAction: vi.fn(async () => {
        await gate.promise;
        return { ok: true };
      }),
    });
    session.stop('run-1');

    const response = await dispatch({
      type: 'EXECUTE_ACTION',
      runId: 'run-1',
      action: { type: 'connect', target: { url: '/in/al/' } },
    });
    gate.resolve();

    expect(response.response).toEqual({
      ok: false,
      cancelled: true,
      reason: 'run-inactive',
    });
    expect(dependencies.executeAction).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {
      runId: 'run-1',
      requestId: '',
      effectId: 'effect-1',
      descriptor: { kind: 'publish' },
    },
  ])(
    'rejects a missing or malformed effect token before an active DOM action starts',
    async (effect) => {
      const { dependencies, dispatch } = setup();

      const result = await dispatch({
        type: 'EXECUTE_ACTION',
        runId: 'run-1',
        action: {
          type: 'post',
          target: { url: '/feed/', meta: { draftId: 'draft-1' } },
        },
        ...(effect ? { effect } : {}),
      });

      expect(result.response).toEqual({ ok: false, reason: 'effect_required' });
      expect(dependencies.executeAction).not.toHaveBeenCalled();
    },
  );

  it('does not overwrite a post-commit DOM observation when STOP lands during the action', async () => {
    const pending = deferred<{ ok: boolean }>();
    const { session, dispatch } = setup({
      executeAction: vi.fn(() => pending.promise),
    });

    const response = dispatch({
      type: 'EXECUTE_ACTION',
      runId: 'run-1',
      action: { type: 'connect', target: { url: '/in/al/' } },
      effect: {
        runId: 'run-1',
        requestId: 'request-1',
        effectId: 'effect-1',
        descriptor: {
          kind: 'connect',
          targetKey: 'member-1',
          person: {
            memberId: 'member-1',
            name: 'Al',
            headline: '',
            profileUrl: 'https://www.linkedin.com/in/al/',
          },
        },
      },
    });
    session.stop('run-1');
    pending.resolve({ ok: true });

    expect((await response).response).toEqual({ ok: true });
  });

  it('allows already-committed profile confirmation after the local STOP echo', async () => {
    const dwell = vi.fn(async () => ({ ok: true }));
    const { session, dispatch } = setup({ dwell });
    session.stop('run-1');

    expect(
      (
        await dispatch({
          type: 'DWELL_PROFILE',
          runId: 'run-1',
          expectedUrl: 'https://www.linkedin.com/in/al/',
          committed: true,
        })
      ).response,
    ).toEqual({ ok: true });
    expect(dwell).toHaveBeenCalledOnce();
  });

  it('routes a publish token through the registered callback and durable commit/settle client', async () => {
    const messages: LodestarMessage[] = [];
    const descriptor = {
      kind: 'publish' as const,
      targetKey: 'draft-1',
      draftId: 'draft-1',
    };
    const client = new EffectRuntimeClient({
      createId: () => 'attempt-1',
      send: async (message) => {
        messages.push(message);
        if (message.type === 'AUTOPILOT_COMMIT_EFFECT') {
          return {
            kind: 'committed',
            admitted: true,
            lease: {
              effectId: message.effectId,
              requestId: message.requestId,
              descriptor,
              stage: 'committed',
              reservedAt: '2026-08-11T10:00:00.000Z',
              committedAt: '2026-08-11T10:00:01.000Z',
              commitAttemptId: message.attemptId,
            },
          };
        }
        if (message.type === 'AUTOPILOT_SETTLE_EFFECT') {
          return {
            kind: 'settled',
            receipt: {
              effectId: message.effectId,
              requestId: message.requestId,
              descriptor,
              reservedAt: '2026-08-11T10:00:00.000Z',
              committedAt: '2026-08-11T10:00:01.000Z',
              commitAttemptId: message.attemptId,
              outcome: message.outcome,
              settledAt: '2026-08-11T10:00:02.000Z',
              accounting: 'applied',
            },
          };
        }
        throw new Error(`unexpected:${message.type}`);
      },
    });
    const executeAction = vi.fn(async (action, _abort, effect) => {
      if (!effect || !effectMatchesAction(effect, action)) {
        return { ok: false, reason: 'effect_mismatch' };
      }
      const result = await client.executeReserved(effect, async ({ commit }) => {
        if (!(await commit())) return { outcome: 'failed', reason: 'commit_rejected' };
        return { outcome: 'confirmed' };
      });
      return { ok: result.outcome === 'confirmed', reason: result.reason };
    });
    const { dispatch } = setup({ executeAction });

    const result = await dispatch({
      type: 'EXECUTE_ACTION',
      runId: 'run-1',
      effect: {
        runId: 'run-1',
        requestId: 'publish-1',
        effectId: 'effect-1',
        descriptor,
      },
      action: {
        type: 'post',
        target: {
          url: 'https://www.linkedin.com/feed/',
          meta: { draftId: 'draft-1' },
        },
        payload: { post: 'hello' },
      },
    });

    expect(result).toEqual({
      returned: true,
      response: { ok: true, reason: undefined },
    });
    expect(executeAction).toHaveBeenCalledOnce();
    expect(messages.map((message) => message.type)).toEqual([
      'AUTOPILOT_COMMIT_EFFECT',
      'AUTOPILOT_SETTLE_EFFECT',
    ]);
  });

  it('rejects missing runId through the registered production listener before any action starts', async () => {
    const { dependencies, dispatch } = setup();
    const messages = [
      { type: 'SLEEP', ms: 30_000 },
      { type: 'DWELL_PROFILE', expectedUrl: 'https://www.linkedin.com/in/al/' },
      { type: 'ACCEPT_INCOMING', cap: 15 },
      {
        type: 'EXECUTE_ACTION',
        action: {
          type: 'like',
          target: { url: '/feed/', meta: { urn: 'urn:1' } },
        },
      },
    ];

    for (const message of messages) {
      const result = await dispatch(message);
      expect(result.returned).toBe(true);
      expect(result.response).toEqual({
        ok: false,
        cancelled: true,
        reason: 'run-inactive',
      });
    }
    expect(dependencies.sleep).not.toHaveBeenCalled();
    expect(dependencies.dwell).not.toHaveBeenCalled();
    expect(dependencies.acceptIncoming).not.toHaveBeenCalled();
    expect(dependencies.executeAction).not.toHaveBeenCalled();
  });
});
