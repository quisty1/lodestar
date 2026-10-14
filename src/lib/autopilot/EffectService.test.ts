import { describe, expect, it } from 'vitest';
import type { Clock, KeyValueStore } from '../ports';
import type { EffectDescriptor } from '../types';
import { COMMENT_BUDGET_KEY } from '../engagement/CommentDayBudget';
import { CONNECT_DAY_BUDGET_KEY, CONNECT_WEEK_BUDGET_KEY } from '../connect/ConnectWeekBudget';
import { CONNECT_HISTORY_KEY } from '../connect/ConnectHistory';
import { RunReportStore } from './RunReportStore';
import { AUTOPILOT_STATE_KEY, RunCoordinator } from './RunCoordinator';
import { EffectAccountant } from './EffectAccountant';
import { EffectService } from './EffectService';

function memoryStore(): KeyValueStore {
  const values = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return values.has(key) ? (values.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      values.set(key, value);
    },
  };
}

function advancingClock(iso = '2026-08-11T10:00:00.000Z') {
  let ms = Date.parse(iso);
  const clock: Clock = { now: () => new Date(ms) };
  return {
    clock,
    advance: (by: number) => {
      ms += by;
    },
  };
}

function harness() {
  const store = memoryStore();
  const time = advancingClock();
  let id = 0;
  const reports = new RunReportStore(store);
  const coordinator = new RunCoordinator({
    store,
    clock: time.clock,
    reports,
    createId: () => `id-${++id}`,
  });
  return { store, time, reports, coordinator };
}

async function begin(coordinator: RunCoordinator) {
  const result = await coordinator.begin({
    requestId: 'start-request',
    host: 'window',
    day: '2026-08-11',
    ceiling: 30,
    used: 0,
  });
  if (result.kind !== 'started') throw new Error(result.kind);
  return result.runId;
}

const person = {
  memberId: 'member-1',
  name: 'Ada',
  headline: 'CTO',
  profileUrl: '/in/ada',
};
const like = (targetKey = 'post-1'): EffectDescriptor => ({
  kind: 'like',
  targetKey,
});
const attempt = (requestId: string) => `${requestId}:attempt`;

async function committed(
  coordinator: RunCoordinator,
  runId: string,
  requestId: string,
  descriptor: EffectDescriptor,
) {
  const reservation = await coordinator.reserveEffect(runId, requestId, descriptor);
  if (reservation.kind !== 'reserved') throw new Error(reservation.kind);
  const admission = await coordinator.commitEffect(
    runId,
    reservation.effectId,
    requestId,
    attempt(requestId),
  );
  if (!admission.admitted) throw new Error(admission.reason);
  return reservation.effectId;
}

describe('EffectService', () => {
  it('settles, applies and marks one receipt exactly once', async () => {
    const { store, time, coordinator } = harness();
    const runId = await begin(coordinator);
    const effectId = await committed(coordinator, runId, 'comment-request', {
      kind: 'comment',
      targetKey: 'post-1',
    });
    const service = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock: time.clock,
    });

    const first = await service.settle(runId, effectId, 'comment-request', 'confirmed', {
      attemptId: attempt('comment-request'),
    });
    const duplicate = await service.settle(runId, effectId, 'comment-request', 'confirmed', {
      attemptId: attempt('comment-request'),
    });

    expect(first).toMatchObject({
      kind: 'settled',
      receipt: { accounting: 'applied' },
    });
    expect(duplicate).toMatchObject({
      kind: 'duplicate',
      receipt: { accounting: 'applied' },
    });
    expect(await store.get(COMMENT_BUDGET_KEY)).toMatchObject({
      used: 1,
      effectIds: [effectId],
    });
  });

  it('replays pending accounting after restart without duplicate sinks', async () => {
    const { store, time, coordinator } = harness();
    const runId = await begin(coordinator);
    const effectId = await committed(coordinator, runId, 'connect-request', {
      kind: 'connect',
      targetKey: person.memberId,
      person,
    });
    await coordinator.settleEffect(runId, effectId, 'connect-request', 'confirmed', {
      attemptId: attempt('connect-request'),
    });
    const service = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock: time.clock,
    });

    expect(await service.replayPending(runId)).toBe(1);
    expect(await service.replayPending(runId)).toBe(0);

    expect(await store.get(CONNECT_WEEK_BUDGET_KEY)).toMatchObject({
      used: 1,
      effectIds: [effectId],
    });
    expect(await store.get(CONNECT_DAY_BUDGET_KEY)).toMatchObject({
      used: 1,
      effectIds: [effectId],
    });
    expect((await coordinator.pendingEffects(runId))?.accounting).toEqual([]);
  });

  it('does not let same-millisecond uncertain accounting mark a confirmed upgrade applied', async () => {
    const { store, time, coordinator } = harness();
    const runId = await begin(coordinator);
    const effectId = await committed(coordinator, runId, 'connect-request', {
      kind: 'connect',
      targetKey: person.memberId,
      person,
    });
    let releaseUncertain!: () => void;
    let enteredUncertain!: () => void;
    const uncertainEntered = new Promise<void>((resolve) => {
      enteredUncertain = resolve;
    });
    const uncertainGate = new Promise<void>((resolve) => {
      releaseUncertain = resolve;
    });
    const crashingService = new EffectService({
      coordinator,
      clock: time.clock,
      accountant: {
        async apply(effect) {
          if (effect.outcome === 'uncertain') {
            enteredUncertain();
            await uncertainGate;
            return;
          }
          throw new Error('confirmed-accounting-crash');
        },
      },
    });

    const uncertain = crashingService.settle(runId, effectId, 'connect-request', 'uncertain', {
      attemptId: attempt('connect-request'),
    });
    await uncertainEntered;
    await expect(
      crashingService.settle(runId, effectId, 'connect-request', 'confirmed', {
        attemptId: attempt('connect-request'),
      }),
    ).rejects.toThrow('confirmed-accounting-crash');
    releaseUncertain();
    await uncertain;

    expect((await coordinator.getState())?.effectLedger?.receipts[effectId]).toMatchObject({
      outcome: 'confirmed',
      accounting: 'pending',
    });
    const restarted = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock: time.clock,
    });
    expect(await restarted.replayPending(runId)).toBe(1);
    expect(await store.get<unknown[]>(CONNECT_HISTORY_KEY)).toHaveLength(1);
    expect((await coordinator.getState())?.effectLedger?.receipts[effectId]).toMatchObject({
      outcome: 'confirmed',
      accounting: 'applied',
    });
  });

  it('drains outside the coordinator lock so a late settlement can land during sleep', async () => {
    const { store, time, coordinator } = harness();
    const runId = await begin(coordinator);
    const effectId = await committed(coordinator, runId, 'like-request', like());
    // The sleep callback closes over the service while it is being constructed.
    let service!: EffectService;
    let slept = false;
    // eslint-disable-next-line prefer-const
    service = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock: time.clock,
      pollMs: 100,
      timeoutMs: 500,
      sleep: async (ms) => {
        time.advance(ms);
        if (!slept) {
          slept = true;
          await service.settle(runId, effectId, 'like-request', 'confirmed', {
            attemptId: attempt('like-request'),
          });
        }
      },
    });

    expect(await service.drain(runId)).toEqual({
      drained: true,
      timedOut: false,
      expired: 0,
    });
    expect((await coordinator.getState())?.used).toBe(1);
  });

  it('times out committed effects to uncertain, replays safety accounting, then permits finalize', async () => {
    const { store, time, coordinator } = harness();
    const runId = await begin(coordinator);
    const effectId = await committed(coordinator, runId, 'like-request', like());
    await coordinator.recordOutcome(runId, 'engagement', {
      executed: 99,
      reason: 'interrupted',
    });
    await coordinator.requestStop(runId, 'interrupted');
    const service = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock: time.clock,
      pollMs: 100,
      timeoutMs: 200,
      sleep: async (ms) => {
        time.advance(ms);
      },
    });

    expect(await service.drain(runId)).toEqual({
      drained: true,
      timedOut: true,
      expired: 1,
    });
    expect((await coordinator.getState())?.effectLedger?.receipts[effectId]).toMatchObject({
      outcome: 'uncertain',
      accounting: 'applied',
    });
    expect((await coordinator.getState())?.used).toBe(1);
    expect((await coordinator.finalize(runId))?.modules).toEqual([
      {
        id: 'engagement',
        executed: 0,
        skipped: 0,
        failed: 1,
        reason: 'interrupted',
      },
    ]);
  });

  it('does not grant a fresh grace window on every worker restart', async () => {
    const { store, time, coordinator } = harness();
    const runId = await begin(coordinator);
    await committed(coordinator, runId, 'like-request', like());
    await coordinator.requestStop(runId, 'interrupted');
    time.advance(1_000);
    const service = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock: time.clock,
      timeoutMs: 200,
      sleep: async () => {
        throw new Error('must expire immediately');
      },
    });

    expect(await service.drain(runId)).toMatchObject({
      drained: true,
      timedOut: true,
      expired: 1,
    });
  });

  it('expires each staggered committed lease only after its own full grace window', async () => {
    const { store, time, coordinator } = harness();
    const runId = await begin(coordinator);
    const firstId = await committed(coordinator, runId, 'first-request', like('first'));
    time.advance(150);
    const secondId = await committed(coordinator, runId, 'second-request', like('second'));
    await coordinator.requestStop(runId, 'interrupted');
    const service = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock: time.clock,
      pollMs: 50,
      timeoutMs: 200,
      sleep: async (ms) => {
        time.advance(ms);
      },
    });

    expect(await service.drain(runId)).toEqual({
      drained: true,
      timedOut: true,
      expired: 2,
    });
    const receipts = (await coordinator.getState())?.effectLedger?.receipts;
    expect(receipts?.[firstId]?.settledAt).toBe('2026-08-11T10:00:00.200Z');
    expect(receipts?.[secondId]?.settledAt).toBe('2026-08-11T10:00:00.350Z');
  });

  it('replays receipts independently when one accountant sink rejects', async () => {
    const { time, coordinator } = harness();
    const runId = await begin(coordinator);
    const firstId = await committed(coordinator, runId, 'first-request', like('first'));
    const secondId = await committed(coordinator, runId, 'second-request', like('second'));
    await coordinator.settleEffect(runId, firstId, 'first-request', 'confirmed', {
      attemptId: attempt('first-request'),
    });
    await coordinator.settleEffect(runId, secondId, 'second-request', 'confirmed', {
      attemptId: attempt('second-request'),
    });
    const applied: string[] = [];
    const service = new EffectService({
      coordinator,
      clock: time.clock,
      accountant: {
        async apply(receipt) {
          if (receipt.effectId === firstId) throw new Error('poison');
          applied.push(receipt.effectId);
        },
      },
    });

    expect(await service.replayPending(runId)).toBe(1);
    expect(applied).toEqual([secondId]);
    expect(await coordinator.pendingEffects(runId)).toMatchObject({
      accounting: [{ effectId: firstId }],
    });
  });

  it('retries a transient accounting rejection during drain without throwing', async () => {
    const { time, coordinator } = harness();
    const runId = await begin(coordinator);
    const effectId = await committed(coordinator, runId, 'like-request', like());
    await coordinator.settleEffect(runId, effectId, 'like-request', 'confirmed', {
      attemptId: attempt('like-request'),
    });
    let calls = 0;
    const service = new EffectService({
      coordinator,
      clock: time.clock,
      pollMs: 100,
      timeoutMs: 200,
      sleep: async (ms) => {
        time.advance(ms);
      },
      accountant: {
        async apply() {
          calls += 1;
          if (calls === 1) throw new Error('transient');
        },
      },
    });

    expect(await service.drain(runId)).toEqual({
      drained: true,
      timedOut: false,
      expired: 0,
    });
    expect(calls).toBe(2);
  });

  it('bounds permanent accounting poison and leaves report finalization blocked', async () => {
    const { time, coordinator, reports } = harness();
    const runId = await begin(coordinator);
    const effectId = await committed(coordinator, runId, 'like-request', like());
    await coordinator.settleEffect(runId, effectId, 'like-request', 'confirmed', {
      attemptId: attempt('like-request'),
    });
    await coordinator.requestStop(runId, 'interrupted');
    let calls = 0;
    const service = new EffectService({
      coordinator,
      clock: time.clock,
      pollMs: 100,
      timeoutMs: 200,
      sleep: async (ms) => {
        time.advance(ms);
      },
      accountant: {
        async apply() {
          calls += 1;
          throw new Error('permanent');
        },
      },
    });

    expect(await service.drain(runId)).toEqual({
      drained: false,
      timedOut: true,
      expired: 0,
    });
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(3);
    expect(await coordinator.finalize(runId)).toBeNull();
    expect(await reports.list()).toEqual([]);
  });

  it('bounds a hanging accounting sink without starving sibling receipts', async () => {
    const { time, coordinator } = harness();
    const runId = await begin(coordinator);
    const hangingId = await committed(coordinator, runId, 'hanging-request', like('hanging'));
    const healthyId = await committed(coordinator, runId, 'healthy-request', like('healthy'));
    await coordinator.settleEffect(runId, hangingId, 'hanging-request', 'confirmed', {
      attemptId: attempt('hanging-request'),
    });
    await coordinator.settleEffect(runId, healthyId, 'healthy-request', 'confirmed', {
      attemptId: attempt('healthy-request'),
    });
    await coordinator.requestStop(runId, 'interrupted');
    const applied: string[] = [];
    const service = new EffectService({
      coordinator,
      clock: time.clock,
      pollMs: 10,
      timeoutMs: 20,
      sleep: async (ms) => {
        time.advance(ms);
      },
      accountant: {
        async apply(receipt) {
          if (receipt.effectId === hangingId) await new Promise<void>(() => {});
          else applied.push(receipt.effectId);
        },
      },
    });

    const result = await Promise.race([
      service.drain(runId),
      new Promise<'hung'>((resolve) =>
        setTimeout(() => {
          resolve('hung');
        }, 100),
      ),
    ]);

    expect(result).toEqual({ drained: false, timedOut: true, expired: 0 });
    expect(applied).toEqual([healthyId]);
    expect(
      (await coordinator.pendingEffects(runId))?.accounting.map((receipt) => receipt.effectId),
    ).toEqual([hangingId]);
  });

  it('clamps a future-dated lease to its first observed grace window', async () => {
    const { store, time, coordinator } = harness();
    const runId = await begin(coordinator);
    const effectId = await committed(coordinator, runId, 'future-request', like('future'));
    const state = (await coordinator.getState())!;
    const lease = state.effectLedger!.active[effectId];
    const futureAt = '9999-01-01T00:00:00.000Z';
    await store.set(AUTOPILOT_STATE_KEY, {
      ...state,
      effectLedger: {
        ...state.effectLedger!,
        active: {
          [effectId]: { ...lease, reservedAt: futureAt, committedAt: futureAt },
        },
      },
    });
    await coordinator.requestStop(runId, 'interrupted');
    let sleeps = 0;
    const service = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock: time.clock,
      pollMs: 50,
      timeoutMs: 200,
      sleep: async (ms) => {
        if (++sleeps > 10) throw new Error('unbounded_future_lease');
        time.advance(ms);
      },
    });

    expect(await service.drain(runId)).toEqual({
      drained: true,
      timedOut: true,
      expired: 1,
    });
    expect(sleeps).toBeLessThanOrEqual(4);
  });

  it('recovery safe-cancels reserved but leaves healthy-running committed work for a late settle', async () => {
    const { store, time, coordinator } = harness();
    const runId = await begin(coordinator);
    const reserved = await coordinator.reserveEffect(runId, 'reserved-request', like('reserved'));
    if (reserved.kind !== 'reserved') throw new Error(reserved.kind);
    const committedId = await committed(coordinator, runId, 'committed-request', like('committed'));
    const service = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock: time.clock,
    });

    expect(await service.recover()).toBeNull();

    const pending = await coordinator.pendingEffects(runId);
    expect(pending?.committed.map((lease) => lease.effectId)).toEqual([committedId]);
    expect((await coordinator.getState())?.effectLedger?.receipts[reserved.effectId]).toMatchObject(
      {
        outcome: 'cancelled',
        accounting: 'applied',
      },
    );
  });

  it('recovery gives a stopping run grace, expires it, replays and finalizes exactly once', async () => {
    const { store, time, coordinator, reports } = harness();
    const runId = await begin(coordinator);
    await committed(coordinator, runId, 'like-request', like());
    await coordinator.recordOutcome(runId, 'engagement', {
      executed: 99,
      reason: 'interrupted',
    });
    await coordinator.requestStop(runId, 'interrupted');
    const service = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock: time.clock,
      pollMs: 100,
      timeoutMs: 200,
      sleep: async (ms) => {
        time.advance(ms);
      },
    });

    const first = await service.recover();
    const second = await service.recover();

    expect(first?.id).toBe(runId);
    expect(second?.id).toBe(runId);
    expect(await reports.list()).toHaveLength(1);
    expect((await coordinator.getState())?.phase).toBe('finished');
  });

  it('replays a late uncertain-to-confirmed upgrade before finalizing exactly one report', async () => {
    const { store, time, coordinator, reports } = harness();
    const runId = await begin(coordinator);
    const effectId = await committed(coordinator, runId, 'connect-request', {
      kind: 'connect',
      targetKey: person.memberId,
      person,
    });
    await coordinator.settleEffect(runId, effectId, 'connect-request', 'uncertain', {
      attemptId: attempt('connect-request'),
      reason: 'channel_closed',
    });
    await coordinator.recordOutcome(runId, 'smart_connect', {
      executed: 99,
      reason: 'interrupted',
    });
    await coordinator.requestStop(runId, 'interrupted');
    const originalRecover = coordinator.recoverInterrupted.bind(coordinator);
    let releaseFinalize!: () => void;
    let enteredFinalize!: () => void;
    const finalizeEntered = new Promise<void>((resolve) => {
      enteredFinalize = resolve;
    });
    const finalizeGate = new Promise<void>((resolve) => {
      releaseFinalize = resolve;
    });
    let paused = false;
    coordinator.recoverInterrupted = async () => {
      if (!paused) {
        paused = true;
        enteredFinalize();
        await finalizeGate;
      }
      return originalRecover();
    };
    const service = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock: time.clock,
    });

    const recovery = service.recover();
    await finalizeEntered;
    expect(
      await coordinator.settleEffect(runId, effectId, 'connect-request', 'confirmed', {
        attemptId: attempt('connect-request'),
      }),
    ).toMatchObject({ kind: 'upgraded', receipt: { accounting: 'pending' } });
    releaseFinalize();
    const report = await recovery;

    expect(report?.modules).toEqual([
      {
        id: 'smart_connect',
        executed: 1,
        skipped: 0,
        failed: 0,
        reason: 'interrupted',
      },
    ]);
    expect(await reports.list()).toHaveLength(1);
    expect(await store.get<unknown[]>(CONNECT_HISTORY_KEY)).toHaveLength(1);
    expect((await coordinator.getState())?.effectLedger?.receipts[effectId]).toMatchObject({
      outcome: 'confirmed',
      accounting: 'applied',
    });
  });

  it('retries finalization when late accounting clears pending after a blocked finalize', async () => {
    const { store, time, coordinator, reports } = harness();
    const runId = await begin(coordinator);
    const effectId = await committed(coordinator, runId, 'connect-request', {
      kind: 'connect',
      targetKey: person.memberId,
      person,
    });
    const baseAccountant = new EffectAccountant(store);
    const initial = new EffectService({
      coordinator,
      accountant: baseAccountant,
      clock: time.clock,
    });
    await initial.settle(runId, effectId, 'connect-request', 'uncertain', {
      attemptId: attempt('connect-request'),
      reason: 'channel_closed',
    });
    await coordinator.requestStop(runId, 'interrupted');

    let enteredFinalize!: () => void;
    let releaseFinalize!: () => void;
    let finalizeReturned!: () => void;
    const finalizeEntered = new Promise<void>((resolve) => {
      enteredFinalize = resolve;
    });
    const finalizeGate = new Promise<void>((resolve) => {
      releaseFinalize = resolve;
    });
    const firstFinalizeReturned = new Promise<void>((resolve) => {
      finalizeReturned = resolve;
    });
    const originalRecover = coordinator.recoverInterrupted.bind(coordinator);
    let firstFinalize = true;
    coordinator.recoverInterrupted = async () => {
      const isFirst = firstFinalize;
      firstFinalize = false;
      if (isFirst) {
        enteredFinalize();
        await finalizeGate;
      }
      const result = await originalRecover();
      if (isFirst) finalizeReturned();
      return result;
    };

    let enteredAccounting!: () => void;
    let releaseAccounting!: () => void;
    let accountingFinished!: () => void;
    const accountingEntered = new Promise<void>((resolve) => {
      enteredAccounting = resolve;
    });
    const accountingGate = new Promise<void>((resolve) => {
      releaseAccounting = resolve;
    });
    const lateAccountingFinished = new Promise<void>((resolve) => {
      accountingFinished = resolve;
    });
    const service = new EffectService({
      coordinator,
      clock: time.clock,
      accountant: {
        async apply(receipt) {
          if (receipt.outcome === 'confirmed') {
            enteredAccounting();
            await accountingGate;
          }
          await baseAccountant.apply(receipt);
        },
      },
    });
    const originalPending = coordinator.pendingEffects.bind(coordinator);
    coordinator.pendingEffects = async (candidateRunId) => {
      if (!firstFinalize) await lateAccountingFinished;
      return originalPending(candidateRunId);
    };

    const recovery = service.recover();
    await finalizeEntered;
    const lateSettlement = service.settle(runId, effectId, 'connect-request', 'confirmed', {
      attemptId: attempt('connect-request'),
    });
    await accountingEntered;
    releaseFinalize();
    await firstFinalizeReturned;
    releaseAccounting();
    await lateSettlement;
    accountingFinished();

    const report = await recovery;

    expect(report?.id).toBe(runId);
    expect(await reports.list()).toHaveLength(1);
    expect((await coordinator.getState())?.phase).toBe('finished');
    expect(await store.get<unknown[]>(CONNECT_HISTORY_KEY)).toHaveLength(1);
  });

  it('delegates a partially-scoped legacy snapshot to interrupted-run recovery', async () => {
    const { store, time, coordinator } = harness();
    await store.set(AUTOPILOT_STATE_KEY, {
      running: true,
      host: 'tab',
      day: '2026-08-11',
      ceiling: 30,
      used: 4,
      actionTimestamps: [],
      actionsSinceBreak: 0,
      manualStop: false,
      startedAt: '2026-08-11T09:00:00.000Z',
      runId: 'legacy-run',
    });
    const service = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock: time.clock,
    });

    expect((await service.recover())?.id).toBe('legacy-run');
    expect((await coordinator.getState())?.phase).toBe('finished');
  });

  it('produces an exact mixed-effect report after service accounting', async () => {
    const { store, time, coordinator } = harness();
    const runId = await begin(coordinator);
    await coordinator.recordOutcome(runId, 'engagement', {
      executed: 50,
      skipped: 2,
      reason: 'done',
    });
    await coordinator.recordOutcome(runId, 'smart_connect', {
      executed: 50,
      reason: 'done',
    });
    const likeId = await committed(coordinator, runId, 'like-request', like());
    const connectId = await committed(coordinator, runId, 'connect-request', {
      kind: 'connect',
      targetKey: person.memberId,
      person,
    });
    const service = new EffectService({
      coordinator,
      accountant: new EffectAccountant(store),
      clock: time.clock,
    });
    await service.settle(runId, likeId, 'like-request', 'confirmed', {
      attemptId: attempt('like-request'),
    });
    await service.settle(runId, connectId, 'connect-request', 'confirmed', {
      attemptId: attempt('connect-request'),
    });

    const report = await coordinator.finalize(runId, 'completed');

    expect(report?.modules).toEqual([
      { id: 'engagement', executed: 1, skipped: 2, failed: 0, reason: 'done' },
      {
        id: 'smart_connect',
        executed: 1,
        skipped: 0,
        failed: 0,
        reason: 'done',
      },
    ]);
  });
});
