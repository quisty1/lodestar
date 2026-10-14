import { describe, expect, it, vi } from 'vitest';
import { RunCoordinator } from '@lib/autopilot/RunCoordinator';
import { RunReportStore } from '@lib/autopilot/RunReportStore';
import { EffectAccountant } from '@lib/autopilot/EffectAccountant';
import { EffectService } from '@lib/autopilot/EffectService';
import { COMMENT_ACTED_KEY, COMMENT_BUDGET_KEY } from '@lib/engagement/CommentDayBudget';
import type { Clock, KeyValueStore } from '@lib/ports';
import { runtimeOk } from '@lib/runtimeProtocol';
import { registerAutopilotRuntime, type AutopilotRuntimeHandlers } from './autopilotRuntime';
import { createEffectRuntimeHandlers } from './effectRuntimeHandlers';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

function store(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T>(key: string) => (data.has(key) ? (data.get(key) as T) : null),
    set: async <T>(key: string, value: T) => {
      data.set(key, value);
    },
  };
}

describe('production effect runtime integration', () => {
  it('crosses the registered callback, fences sender, accounts once and finalizes after late settle', async () => {
    const db = store();
    const clock: Clock = { now: () => new Date('2026-08-11T10:00:00.000Z') };
    let nextId = 0;
    const reports = new RunReportStore(db);
    const coordinator = new RunCoordinator({
      store: db,
      clock,
      reports,
      createId: () => `id-${++nextId}`,
    });
    const effects = new EffectService({
      coordinator,
      accountant: new EffectAccountant(db),
      clock,
      sleep: async () => undefined,
      timeoutMs: 10,
      pollMs: 1,
    });
    const begun = await coordinator.begin({
      requestId: 'start-1',
      host: 'tab',
      day: '2026-08-11',
      ceiling: 10,
      used: 0,
    });
    if (begun.kind !== 'started') throw new Error('run not started');
    await coordinator.setTarget(begun.runId, {
      tabId: 7,
      expectedUrl: 'https://www.linkedin.com/feed/',
    });
    const onSettled = vi.fn();
    const effectHandlers = createEffectRuntimeHandlers({ coordinator, effects, onSettled });
    let listener: Listener | undefined;
    const base: AutopilotRuntimeHandlers = {
      status: async () => runtimeOk(await coordinator.status()),
      start: vi.fn(),
      stop: vi.fn(),
      mayAct: vi.fn(),
      risk: vi.fn(),
      ended: vi.fn(),
      ...effectHandlers,
    };
    registerAutopilotRuntime(
      {
        addListener: (next) => {
          listener = next;
        },
      },
      base,
    );
    if (!listener) throw new Error('listener missing');
    const dispatch = (message: unknown, tabId = 7) =>
      new Promise<unknown>((resolve) => {
        expect(listener!(message, { tab: { id: tabId } }, resolve)).toBe(true);
      });
    const descriptor = {
      kind: 'comment' as const,
      targetKey: 'urn:li:activity:1',
      postUrn: 'urn:li:activity:1',
    };

    const wrong = await dispatch(
      {
        type: 'AUTOPILOT_RESERVE_EFFECT',
        runId: begun.runId,
        requestId: 'comment-1',
        descriptor,
      },
      99,
    );
    expect(wrong).toMatchObject({ canExecute: false, kind: 'inactive' });

    const reserved = (await dispatch({
      type: 'AUTOPILOT_RESERVE_EFFECT',
      runId: begun.runId,
      requestId: 'comment-1',
      descriptor,
    })) as { effectId: string };
    expect(await dispatch({ type: 'AUTOPILOT_ACTED', runId: begun.runId, ok: true })).toEqual({
      ok: false,
    });
    expect((await coordinator.getState())?.used).toBe(0);
    await dispatch({
      type: 'AUTOPILOT_COMMIT_EFFECT',
      runId: begun.runId,
      requestId: 'comment-1',
      effectId: reserved.effectId,
      attemptId: 'attempt-1',
    });
    await coordinator.requestStop(begun.runId, 'manual');
    const settled = await dispatch({
      type: 'AUTOPILOT_SETTLE_EFFECT',
      runId: begun.runId,
      requestId: 'comment-1',
      effectId: reserved.effectId,
      attemptId: 'attempt-1',
      outcome: 'confirmed',
    });

    expect(settled).toMatchObject({ kind: 'settled', receipt: { accounting: 'applied' } });
    expect(db.data.get(COMMENT_BUDGET_KEY)).toMatchObject({
      used: 1,
      effectIds: [reserved.effectId],
    });
    expect(db.data.get(COMMENT_ACTED_KEY)).toEqual(['urn:li:activity:1']);
    expect(onSettled).toHaveBeenCalledWith(begun.runId);
    expect((await effects.drain(begun.runId)).drained).toBe(true);
    await coordinator.finalize(begun.runId);
    await coordinator.finalize(begun.runId);
    expect(await reports.list()).toHaveLength(1);
  });
});
