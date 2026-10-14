import { describe, expect, it, vi } from 'vitest';
import { EffectAccountant } from '@lib/autopilot/EffectAccountant';
import { EffectService } from '@lib/autopilot/EffectService';
import { AUTOPILOT_STATE_KEY, RunCoordinator } from '@lib/autopilot/RunCoordinator';
import { RunReportStore } from '@lib/autopilot/RunReportStore';
import { FakeStore } from '@lib/storage/fakeStore';
import { EffectRunFinalizer } from './EffectRunFinalizer';

function deferred<T>() {
  let resolve!: (value?: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done as (value?: T) => void;
  });
  return { promise, resolve };
}

describe('EffectRunFinalizer', () => {
  it('persists stopping first and returns it without waiting for content/drain', async () => {
    const stopSent = deferred<undefined>();
    const requestStop = vi.fn(async () => ({
      runId: 'run-1',
      phase: 'stopping' as const,
      tabId: 7,
    }));
    const finalizer = new EffectRunFinalizer({
      requestStop,
      reconcile: vi.fn(async () => undefined),
      drain: vi.fn(async () => ({ drained: true, timedOut: false, expired: 0 })),
      finalize: vi.fn(async () => null),
      stopContent: vi.fn(() => stopSent.promise),
      clearActivity: vi.fn(async () => undefined),
      broadcastReport: vi.fn(),
    });

    const stopped = await finalizer.request('run-1', 'manual');

    expect(stopped?.phase).toBe('stopping');
    expect(requestStop).toHaveBeenCalledOnce();
    expect(finalizer.isFinishing('run-1')).toBe(true);
    stopSent.resolve();
    await finalizer.wait('run-1');
  });

  it('drains before one exact final report across concurrent finish requests', async () => {
    const order: string[] = [];
    const report = { id: 'run-1' } as never;
    const finalize = vi.fn(async () => {
      order.push('finalize');
      return report;
    });
    const broadcastReport = vi.fn(() => {
      order.push('broadcast');
    });
    const finalizer = new EffectRunFinalizer({
      requestStop: vi.fn(async () => ({ runId: 'run-1', phase: 'stopping' as const })),
      reconcile: vi.fn(async () => undefined),
      stopContent: vi.fn(async () => {
        order.push('content');
      }),
      clearActivity: vi.fn(async () => {
        order.push('clear');
      }),
      drain: vi.fn(async () => {
        order.push('drain');
        return { drained: true, timedOut: false, expired: 0 };
      }),
      finalize,
      broadcastReport,
    });

    await Promise.all([finalizer.finish('run-1'), finalizer.finish('run-1')]);

    expect(order).toEqual(['content', 'clear', 'drain', 'finalize', 'broadcast']);
    expect(finalize).toHaveBeenCalledOnce();
    expect(broadcastReport).toHaveBeenCalledOnce();
  });

  it('reconciles reserved leases and retries a transient incomplete drain', async () => {
    const retries: Array<() => void> = [];
    const reconcile = vi.fn(async () => undefined);
    const drain = vi
      .fn()
      .mockResolvedValueOnce({ drained: false, timedOut: false, expired: 0 })
      .mockResolvedValueOnce({ drained: true, timedOut: false, expired: 0 });
    const finalize = vi.fn(async () => ({ id: 'run-1' }) as never);
    const broadcastReport = vi.fn();
    const finalizer = new EffectRunFinalizer({
      requestStop: vi.fn(async () => ({ runId: 'run-1', phase: 'stopping' as const })),
      reconcile,
      stopContent: vi.fn(async () => undefined),
      clearActivity: vi.fn(async () => undefined),
      drain,
      finalize,
      broadcastReport,
      scheduleRetry: (retry) => {
        retries.push(retry);
      },
    });

    await finalizer.finish('run-1');
    expect(finalize).not.toHaveBeenCalled();
    expect(retries).toHaveLength(1);
    retries.shift()!();
    await vi.waitFor(() => {
      expect(finalize).toHaveBeenCalledOnce();
    });

    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(broadcastReport).toHaveBeenCalledOnce();
  });

  it('retries after a transient drain rejection and emits one report', async () => {
    const retries: Array<() => void> = [];
    const drain = vi
      .fn()
      .mockRejectedValueOnce(new Error('storage temporarily unavailable'))
      .mockResolvedValueOnce({ drained: true, timedOut: false, expired: 0 });
    const finalize = vi.fn(async () => ({ id: 'run-1' }) as never);
    const broadcastReport = vi.fn();
    const finalizer = new EffectRunFinalizer({
      requestStop: vi.fn(async () => ({ runId: 'run-1', phase: 'stopping' as const })),
      reconcile: vi.fn(async () => undefined),
      stopContent: vi.fn(async () => undefined),
      clearActivity: vi.fn(async () => undefined),
      drain,
      finalize,
      broadcastReport,
      scheduleRetry: (retry) => {
        retries.push(retry);
      },
    });

    await expect(finalizer.finish('run-1')).resolves.toBeUndefined();
    expect(retries).toHaveLength(1);
    retries.shift()!();
    await vi.waitFor(() => {
      expect(finalize).toHaveBeenCalledOnce();
    });

    expect(drain).toHaveBeenCalledTimes(2);
    expect(broadcastReport).toHaveBeenCalledOnce();
  });

  it('re-drains when a late receipt upgrade races between drain and finalize', async () => {
    const retries: Array<() => void> = [];
    let pendingAccounting = false;
    const drain = vi.fn(async () => {
      pendingAccounting = false;
      return { drained: true, timedOut: false, expired: 0 };
    });
    const finalize = vi.fn(async () => {
      if (finalize.mock.calls.length === 1) {
        pendingAccounting = true;
        return null;
      }
      return { id: 'run-1' } as never;
    });
    const broadcastReport = vi.fn();
    const finalizer = new EffectRunFinalizer({
      requestStop: vi.fn(async () => ({ runId: 'run-1', phase: 'stopping' as const })),
      reconcile: vi.fn(async () => undefined),
      stopContent: vi.fn(async () => undefined),
      clearActivity: vi.fn(async () => undefined),
      drain,
      finalize,
      broadcastReport,
      scheduleRetry: (retry) => {
        retries.push(retry);
      },
    });

    await finalizer.finish('run-1');
    expect(pendingAccounting).toBe(true);
    expect(retries).toHaveLength(1);
    retries.shift()!();
    await vi.waitFor(() => {
      expect(broadcastReport).toHaveBeenCalledOnce();
    });

    expect(drain).toHaveBeenCalledTimes(2);
    expect(finalize).toHaveBeenCalledTimes(2);
  });

  it('ignores an old scheduled retry after an early successful finish broadcast', async () => {
    const retries: Array<() => void> = [];
    const drain = vi
      .fn()
      .mockResolvedValueOnce({ drained: false, timedOut: false, expired: 0 })
      .mockResolvedValue({ drained: true, timedOut: false, expired: 0 });
    const broadcastReport = vi.fn();
    const finalizer = new EffectRunFinalizer({
      requestStop: vi.fn(async () => ({ runId: 'run-1', phase: 'stopping' as const })),
      reconcile: vi.fn(async () => undefined),
      stopContent: vi.fn(async () => undefined),
      clearActivity: vi.fn(async () => undefined),
      drain,
      finalize: vi.fn(async () => ({ id: 'run-1' }) as never),
      broadcastReport,
      scheduleRetry: (retry) => {
        retries.push(retry);
      },
    });

    await finalizer.finish('run-1');
    expect(retries).toHaveLength(1);
    await finalizer.finish('run-1');
    retries.shift()!();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(broadcastReport).toHaveBeenCalledOnce();
    expect(drain).toHaveBeenCalledTimes(2);
  });

  it('cold-recovers a stopping snapshot with a reserved lease before one final report', async () => {
    const store = new FakeStore();
    const clock = { now: () => new Date('2026-08-11T10:00:00.000Z') };
    const reports = new RunReportStore(store);
    let nextId = 0;
    const createCoordinator = () =>
      new RunCoordinator({
        store,
        clock,
        reports,
        createId: () => `id-${++nextId}`,
      });
    const firstWorker = createCoordinator();
    const begun = await firstWorker.begin({
      requestId: 'start-1',
      host: 'tab',
      day: '2026-08-11',
      ceiling: 10,
      used: 0,
    });
    if (begun.kind !== 'started') throw new Error(begun.kind);
    const reserved = await firstWorker.reserveEffect(begun.runId, 'comment-1', {
      kind: 'comment',
      targetKey: 'post-1',
      postUrn: 'post-1',
    });
    if (reserved.kind !== 'reserved') throw new Error(reserved.kind);
    const running = (await firstWorker.getState())!;
    const stopped = {
      ...running,
      running: false,
      phase: 'stopping' as const,
      stopReason: 'interrupted' as const,
      endedAt: clock.now().toISOString(),
    };
    await store.set(AUTOPILOT_STATE_KEY, stopped);

    const restarted = createCoordinator();
    const effects = new EffectService({
      coordinator: restarted,
      accountant: new EffectAccountant(store),
      clock,
      timeoutMs: 1,
      pollMs: 1,
      sleep: async () => undefined,
    });
    const broadcastReport = vi.fn();
    const finalizer = new EffectRunFinalizer({
      requestStop: (runId, reason) => restarted.requestStop(runId, reason),
      reconcile: (runId) => restarted.reconcileEffects(runId),
      stopContent: async () => undefined,
      clearActivity: async () => undefined,
      drain: (runId) => effects.drain(runId),
      finalize: (runId) => restarted.finalize(runId),
      broadcastReport,
    });

    await finalizer.finish(begun.runId, stopped);

    expect((await restarted.getState())?.effectLedger?.receipts[reserved.effectId]).toMatchObject({
      outcome: 'cancelled',
      accounting: 'applied',
    });
    expect(await reports.list()).toHaveLength(1);
    expect(broadcastReport).toHaveBeenCalledOnce();
  });
});
