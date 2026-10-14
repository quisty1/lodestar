import { describe, expect, it } from 'vitest';
import type { Clock, KeyValueStore } from '../ports';
import type {
  AutopilotState,
  AutopilotStatus,
  EffectDescriptor,
  EffectLedgerV1,
  ModuleOutcome,
  StopReason,
} from '../types';
import type { RiskMarker } from './RiskAssessor';
import { RunReportStore } from './RunReportStore';
import { AUTOPILOT_STATE_KEY, RunCoordinator } from './RunCoordinator';

function deferredStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const values = new Map(Object.entries(initial));
  return {
    async get<T>(key: string) {
      await Promise.resolve();
      return values.has(key) ? (values.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      await Promise.resolve();
      values.set(key, value);
    },
  };
}

function fixedClock(iso = '2026-08-11T10:00:00.000Z'): Clock & { set(iso: string): void } {
  let current = new Date(iso);
  return {
    now: () => new Date(current),
    set: (next) => {
      current = new Date(next);
    },
  };
}

function coordinator(store = deferredStore(), clock = fixedClock()) {
  let nextId = 0;
  return {
    clock,
    reports: new RunReportStore(store),
    subject: new RunCoordinator({
      store,
      clock,
      reports: new RunReportStore(store),
      createId: () => `run-${++nextId}`,
    }),
    store,
  };
}

const beginInput = (requestId = 'request-1') => ({
  requestId,
  host: 'window' as const,
  day: '2026-08-11',
  ceiling: 30,
  used: 7,
  tabId: 42,
  expectedUrl: 'https://www.linkedin.com/feed/',
});

const likeEffect = (targetKey = 'urn:li:activity:1'): EffectDescriptor => ({
  kind: 'like',
  targetKey,
  postUrn: targetKey,
});

async function reserve(
  subject: RunCoordinator,
  runId: string,
  requestId: string,
  descriptor: EffectDescriptor,
) {
  const result = await subject.reserveEffect(runId, requestId, descriptor);
  if (result.kind !== 'reserved') throw new Error(`Expected reserved, got ${result.kind}`);
  return result;
}

async function markAccounted(subject: RunCoordinator, runId: string, effectId: string) {
  const receipt = (await subject.getState())?.effectLedger?.receipts[effectId];
  if (!receipt) throw new Error(`Missing receipt ${effectId}`);
  return subject.markEffectAccounted(runId, effectId, {
    settledAt: receipt.settledAt,
    outcome: receipt.outcome,
  });
}

async function start(subject: RunCoordinator, requestId = 'request-1') {
  const result = await subject.begin(beginInput(requestId));
  if (result.kind !== 'started') throw new Error(`Expected started, got ${result.kind}`);
  return result;
}

describe('RunCoordinator', () => {
  it('returns a concrete idle status when no state exists', async () => {
    const { subject } = coordinator();

    expect(await subject.status()).toEqual({
      running: false,
      used: 0,
      ceiling: 0,
      revision: 0,
    });
  });

  it('persists a monotonic revision across mutations and consecutive runs', async () => {
    const { subject } = coordinator();
    const first = await start(subject);
    const revisions = [(await subject.status()).revision];

    await subject.setPhase(first.runId, 'feed_preflight');
    revisions.push((await subject.status()).revision);
    await subject.requestStop(first.runId, 'manual');
    revisions.push((await subject.status()).revision);
    await subject.finalize(first.runId);
    revisions.push((await subject.status()).revision);
    await start(subject, 'request-2');
    revisions.push((await subject.status()).revision);

    expect(revisions).toEqual([1, 2, 3, 5, 6]);
    expect((await subject.getState())?.revision).toBe(6);
  });

  it('makes duplicate begin request ids idempotent', async () => {
    const { subject } = coordinator();

    const first = await start(subject);
    const duplicate = await subject.begin(beginInput());

    expect(first.kind).toBe('started');
    expect(duplicate.kind).toBe('duplicate');
    expect(duplicate.runId).toBe(first.runId);
    expect((await subject.getState())?.used).toBe(7);
  });

  it('refuses to replace an opaque future ledger when beginning a new run', async () => {
    const futureLedger = { version: 2, active: { future: true }, receipts: {} };
    const finished = {
      running: false,
      host: 'window',
      day: '2026-08-11',
      ceiling: 30,
      used: 7,
      actionTimestamps: [],
      actionsSinceBreak: 0,
      manualStop: false,
      startedAt: '2026-08-11T09:00:00.000Z',
      runId: 'future-run',
      startRequestId: 'future-request',
      phase: 'finished',
      startedUsed: 7,
      riskMarkers: [],
      updatedAt: '2026-08-11T10:00:00.000Z',
      effectLedger: futureLedger,
      revision: 4,
    } as unknown as AutopilotState;
    const store = deferredStore({ [AUTOPILOT_STATE_KEY]: finished });
    const { subject } = coordinator(store);
    const before = await subject.getState();

    expect(await subject.begin(beginInput('new-request'))).toMatchObject({
      kind: 'recovery-required',
      runId: 'future-run',
    });
    expect(await subject.getState()).toBe(before);
    expect((await subject.getState())?.effectLedger).toBe(futureLedger);
    expect((await subject.getState())?.revision).toBe(4);
  });

  it('reports a scoped active run with a corrupt ledger as recovery-required but still permits STOP', async () => {
    const { subject, store } = coordinator();
    const started = await start(subject);
    const futureLedger = { version: 2, active: { opaque: true }, receipts: {} };
    const active = {
      ...(await subject.getState())!,
      effectLedger: futureLedger,
    };
    await store.set(AUTOPILOT_STATE_KEY, active as unknown as AutopilotState);
    const before = await subject.getState();

    expect(await subject.isActive(started.runId)).toBe(false);
    expect(await subject.status()).toMatchObject({
      running: false,
      recoveryRequired: true,
    });
    expect(await subject.recoverInterrupted()).toBeNull();
    expect(await subject.getState()).toBe(before);

    expect(await subject.requestStop(started.runId, 'manual')).toMatchObject({
      running: false,
      phase: 'stopping',
      effectLedger: futureLedger,
    });
  });

  it('rejects a different request while a scoped run is active', async () => {
    const { subject } = coordinator();
    const first = await start(subject);

    const second = await subject.begin(beginInput('request-2'));

    expect(second).toMatchObject({
      kind: 'already-running',
      runId: first.runId,
    });
  });

  it('serializes concurrent acted mutations without losing an increment', async () => {
    const { subject } = coordinator();
    const started = await start(subject);

    await Promise.all([subject.recordActed(started.runId), subject.recordActed(started.runId)]);

    const at = Date.parse('2026-08-11T10:00:00.000Z');
    expect(await subject.getState()).toMatchObject({
      used: 9,
      actionTimestamps: [at, at],
    });
  });

  it('persists the selected target through the coordinator', async () => {
    const { subject } = coordinator();
    const started = await start(subject);

    await subject.setTarget(started.runId, {
      tabId: 77,
      windowId: 5,
      expectedUrl: 'https://www.linkedin.com/feed/',
    });

    expect(await subject.getState()).toMatchObject({
      tabId: 77,
      windowId: 5,
      expectedUrl: 'https://www.linkedin.com/feed/',
    });
  });

  it('persists stop before ignoring every late run mutation', async () => {
    const { subject, clock } = coordinator();
    const started = await start(subject);
    clock.set('2026-08-11T10:05:00.000Z');

    await subject.requestStop(started.runId, 'manual');
    await Promise.all([
      subject.recordActed(started.runId),
      subject.recordRisk(started.runId, 'challenge'),
      subject.setPhase(started.runId, 'feed_loop', { stage: 'late stage' }),
    ]);

    expect(await subject.getState()).toMatchObject({
      running: false,
      phase: 'stopping',
      used: 7,
      riskMarkers: [],
      stopReason: 'manual',
      endedAt: '2026-08-11T10:05:00.000Z',
    });
  });

  it('keeps the first stop reason and ended time stable', async () => {
    const { subject, clock } = coordinator();
    const started = await start(subject);
    await subject.requestStop(started.runId, 'risk');
    clock.set('2026-08-11T11:00:00.000Z');

    await subject.requestStop(started.runId, 'manual');

    expect(await subject.getState()).toMatchObject({
      stopReason: 'risk',
      endedAt: '2026-08-11T10:00:00.000Z',
    });
  });

  it('prevents an old run id from mutating a newer run', async () => {
    const { subject } = coordinator();
    const old = await start(subject);
    await subject.finalize(old.runId, 'completed');
    const current = await start(subject, 'request-2');

    await subject.recordActed(old.runId);
    await subject.recordRisk(old.runId, 'challenge');
    await subject.recordOutcome(old.runId, 'smart_connect', {
      executed: 99,
      reason: 'late',
    });

    expect(await subject.getState()).toMatchObject({
      runId: current.runId,
      used: 7,
      riskMarkers: [],
      moduleOutcomes: {},
    });
  });

  it('persists risk markers and per-module outcomes on the active run', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    const outcome: ModuleOutcome = { executed: 3, reason: 'done' };

    await subject.recordRisk(started.runId, 'challenge');
    await subject.recordOutcome(started.runId, 'smart_connect', outcome);

    expect(await subject.getState()).toMatchObject({
      riskMarkers: ['challenge'],
      moduleOutcomes: { smart_connect: outcome },
    });
  });

  it('updates stage metadata only for the matching active run', async () => {
    const { subject } = coordinator();
    const started = await start(subject);

    await subject.setStage(started.runId, 'Открываю ленту…', 'https://www.linkedin.com/feed/');
    await subject.setStage('old-run', 'late');

    expect(await subject.getState()).toMatchObject({
      runId: started.runId,
      phase: 'starting',
      stage: 'Открываю ленту…',
      expectedUrl: 'https://www.linkedin.com/feed/',
    });
  });

  it('finalizes a pre-loop-only run while ledger remains execution SSOT', async () => {
    const { subject, reports } = coordinator();
    const started = await start(subject);
    await subject.recordOutcome(started.runId, 'profile_views', {
      executed: 2,
      reason: 'done',
    });

    const report = await subject.finalize(started.runId, 'completed');

    expect(report).toMatchObject({
      id: started.runId,
      stopReason: 'completed',
      modules: [{ id: 'profile_views', executed: 0, reason: 'done' }],
    });
    expect(await reports.list()).toHaveLength(1);
    expect(await subject.getState()).toMatchObject({
      running: false,
      phase: 'finished',
    });
  });

  it('does not mix legacy acted deltas into a ledger-backed report', async () => {
    const { subject, reports } = coordinator();
    const started = await start(subject);
    await subject.recordOutcome(started.runId, 'engagement', {
      executed: 999,
      reason: 'budget_reached',
    });
    await Promise.all([
      subject.recordActed(started.runId),
      subject.recordActed(started.runId),
      subject.recordActed(started.runId),
    ]);

    await subject.finalize(started.runId, 'budget');

    expect((await reports.list())[0]?.modules[0]).toMatchObject({
      id: 'engagement',
      executed: 0,
      reason: 'budget_reached',
    });
  });

  it('serializes concurrent finalize calls into one report', async () => {
    const { subject, reports } = coordinator();
    const started = await start(subject);

    const [one, two] = await Promise.all([
      subject.finalize(started.runId, 'completed'),
      subject.finalize(started.runId, 'completed'),
    ]);

    expect(one?.id).toBe(started.runId);
    expect(two?.id).toBe(started.runId);
    expect(await reports.list()).toHaveLength(1);
  });

  it.each([false, true])(
    'recovers finalizing state with existing report=%s',
    async (reportExists) => {
      const store = deferredStore();
      const clock = fixedClock();
      const reports = new RunReportStore(store);
      const original = new RunCoordinator({
        store,
        clock,
        reports,
        createId: () => 'recovery-run',
      });
      const started = await start(original);
      await original.requestStop(started.runId, 'interrupted');
      const stopping = await original.getState();
      if (!stopping) throw new Error('missing stopping state');
      await store.set(AUTOPILOT_STATE_KEY, {
        ...stopping,
        phase: 'finalizing',
      });
      if (reportExists) {
        await reports.add({
          id: started.runId,
          startedAt: stopping.startedAt,
          endedAt: stopping.endedAt ?? stopping.startedAt,
          host: stopping.host,
          stopReason: 'interrupted',
          modules: [],
        });
      }
      const recovered = new RunCoordinator({
        store,
        clock,
        reports,
        createId: () => 'unused',
      });

      const report = await recovered.finalize(started.runId);

      expect(report?.id).toBe(started.runId);
      expect(await reports.list()).toHaveLength(1);
      expect(await recovered.getState()).toMatchObject({
        phase: 'finished',
        stopReason: 'interrupted',
      });
    },
  );

  it.each([false, true])(
    'recovers persisted stopping state with existing report=%s',
    async (reportExists) => {
      const store = deferredStore();
      const clock = fixedClock();
      const reports = new RunReportStore(store);
      const original = new RunCoordinator({
        store,
        clock,
        reports,
        createId: () => 'stopping-run',
      });
      const started = await start(original);
      await original.requestStop(started.runId, 'interrupted');
      const stopping = await original.getState();
      if (!stopping) throw new Error('missing stopping state');
      expect(stopping.phase).toBe('stopping');
      if (reportExists) {
        await reports.add({
          id: started.runId,
          startedAt: stopping.startedAt,
          endedAt: stopping.endedAt ?? stopping.startedAt,
          host: stopping.host,
          stopReason: 'interrupted',
          modules: [],
        });
      }
      const recovered = new RunCoordinator({
        store,
        clock,
        reports,
        createId: () => 'unused',
      });

      const report = await recovered.finalize(started.runId);

      expect(report?.id).toBe(started.runId);
      expect(await reports.list()).toHaveLength(1);
      expect(await recovered.getState()).toMatchObject({
        running: false,
        phase: 'finished',
        stopReason: 'interrupted',
      });
    },
  );

  it('identifies legacy running state as recovery-required, never active', async () => {
    const legacy: AutopilotState = {
      running: true,
      host: 'tab',
      day: '2026-08-10',
      ceiling: 30,
      used: 8,
      actionTimestamps: [],
      actionsSinceBreak: 0,
      manualStop: false,
      startedAt: '2026-08-10T09:00:00.000Z',
    };
    const { subject } = coordinator(deferredStore({ [AUTOPILOT_STATE_KEY]: legacy }));

    expect(await subject.isActive()).toBe(false);
    expect(await subject.status()).toMatchObject({
      running: false,
      recoveryRequired: true,
      used: 8,
      ceiling: 30,
    });
  });

  it('archives a legacy running state as interrupted and then permits a new run', async () => {
    const legacy: AutopilotState = {
      running: true,
      host: 'tab',
      day: '2026-08-10',
      ceiling: 30,
      used: 8,
      actionTimestamps: [1, 2],
      actionsSinceBreak: 2,
      manualStop: false,
      startedAt: '2026-08-10T09:00:00.000Z',
      moduleOutcomes: { profile_views: { executed: 2, reason: 'done' } },
    };
    const { subject, reports } = coordinator(deferredStore({ [AUTOPILOT_STATE_KEY]: legacy }));

    const recovered = await subject.recoverInterrupted();
    const next = await subject.begin(beginInput('request-after-recovery'));

    expect(recovered).toMatchObject({
      id: 'run-1',
      startedAt: legacy.startedAt,
      stopReason: 'interrupted',
      modules: [{ id: 'profile_views', executed: 2, reason: 'done' }],
    });
    expect(await reports.list()).toHaveLength(1);
    expect(next).toMatchObject({ kind: 'started', runId: 'run-2' });
  });

  it('treats unknown future phases safely instead of activating them', async () => {
    const future = {
      running: true,
      host: 'window',
      day: '2026-08-11',
      ceiling: 30,
      used: 4,
      actionTimestamps: [],
      actionsSinceBreak: 0,
      manualStop: false,
      startedAt: '2026-08-11T09:00:00.000Z',
      runId: 'future-run',
      startRequestId: 'future-request',
      phase: 'future-phase',
      startedUsed: 4,
      riskMarkers: [],
      updatedAt: '2026-08-11T09:00:00.000Z',
      schemaVersion: 999,
    };
    const { subject } = coordinator(deferredStore({ [AUTOPILOT_STATE_KEY]: future }));

    expect(await subject.isActive('future-run')).toBe(false);
    expect(await subject.status()).toMatchObject({
      running: false,
      recoveryRequired: true,
    });
  });

  it('archives an unknown future running phase without treating it as healthy', async () => {
    const future = {
      running: true,
      host: 'window',
      day: '2026-08-11',
      ceiling: 30,
      used: 4,
      actionTimestamps: [],
      actionsSinceBreak: 0,
      manualStop: false,
      startedAt: '2026-08-11T09:00:00.000Z',
      runId: 'future-run',
      startRequestId: 'future-request',
      phase: 'future-phase',
      startedUsed: 4,
      riskMarkers: [],
      updatedAt: '2026-08-11T09:00:00.000Z',
      moduleOutcomes: { smart_connect: { executed: 1, reason: 'partial' } },
      schemaVersion: 999,
    };
    const { subject, reports } = coordinator(deferredStore({ [AUTOPILOT_STATE_KEY]: future }));

    const recovered = await subject.recoverInterrupted();
    const next = await subject.begin(beginInput('request-after-future'));

    expect(recovered).toMatchObject({
      id: 'future-run',
      stopReason: 'interrupted',
      modules: [{ id: 'smart_connect', executed: 1, reason: 'partial' }],
    });
    expect(await reports.list()).toHaveLength(1);
    expect(next).toMatchObject({ kind: 'started', runId: 'run-1' });
  });

  it('does not normalize or write a legacy/future state carrying an opaque ledger', async () => {
    const futureLedger = { version: 2, active: { future: true }, receipts: {} };
    const future = {
      running: true,
      host: 'window',
      day: '2026-08-11',
      ceiling: 30,
      used: 4,
      actionTimestamps: [],
      actionsSinceBreak: 0,
      manualStop: false,
      startedAt: '2026-08-11T09:00:00.000Z',
      runId: 'future-run',
      startRequestId: 'future-request',
      phase: 'future-phase',
      startedUsed: 4,
      riskMarkers: [],
      updatedAt: '2026-08-11T09:00:00.000Z',
      effectLedger: futureLedger,
      revision: 9,
    } as unknown as AutopilotState;
    const store = deferredStore({ [AUTOPILOT_STATE_KEY]: future });
    const { subject, reports } = coordinator(store);
    const before = await subject.getState();

    await expect(subject.recoverInterrupted()).resolves.toBeNull();
    expect(await subject.getState()).toBe(before);
    expect((await subject.getState())?.effectLedger).toBe(futureLedger);
    expect((await subject.getState())?.revision).toBe(9);
    expect(await reports.list()).toEqual([]);
  });

  it.each(['committed', 'pending', 'applied'] as const)(
    'fails closed for a partial-scope state carrying %s effect work',
    async (work) => {
      const { subject, store, reports } = coordinator();
      const started = await start(subject);
      const effect = await reserve(subject, started.runId, 'effect-request', likeEffect());
      await subject.commitEffect(
        started.runId,
        effect.effectId,
        'effect-request',
        'effect-attempt',
      );
      if (work === 'pending' || work === 'applied') {
        await subject.settleEffect(started.runId, effect.effectId, 'effect-request', 'confirmed', {
          attemptId: 'effect-attempt',
        });
      }
      if (work === 'applied') await markAccounted(subject, started.runId, effect.effectId);
      const { phase: _missing, ...partial } = (await subject.getState())!;
      await store.set(AUTOPILOT_STATE_KEY, partial);
      const before = await subject.getState();

      await expect(subject.recoverInterrupted()).resolves.toBeNull();
      expect(await subject.begin(beginInput('new-request'))).toMatchObject({
        kind: 'recovery-required',
        runId: started.runId,
      });
      expect(await subject.getState()).toBe(before);
      expect(await reports.list()).toEqual([]);
    },
  );

  it('never interrupts a healthy scoped active run during recovery', async () => {
    const { subject, reports } = coordinator();
    const started = await start(subject);

    expect(await subject.recoverInterrupted()).toBeNull();

    expect(await subject.isActive(started.runId)).toBe(true);
    expect(await reports.list()).toEqual([]);
  });

  it('broadcast can reenter status and a mutation without deadlocking the mutation lock', async () => {
    const store = deferredStore();
    const clock = fixedClock();
    const reports = new RunReportStore(store);
    const seen: string[] = [];
    let resolveSecond!: () => void;
    const secondBroadcast = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    // The broadcast callback closes over the coordinator while it is being constructed.
    let subject!: RunCoordinator;
    // eslint-disable-next-line prefer-const
    subject = new RunCoordinator({
      store,
      clock,
      reports,
      createId: () => 'broadcast-run',
      broadcast: async (status: AutopilotStatus) => {
        seen.push(status.stage ?? status.phase ?? 'idle');
        if (seen.length === 1 && status.runId) {
          // The assertion has to run inside the broadcast, which is the re-entrancy under test.
          // eslint-disable-next-line vitest/no-conditional-expect
          expect((await subject.status()).runId).toBe(status.runId);
          await subject.setStage(status.runId, 'from-broadcast');
        } else if (seen.length === 2) {
          resolveSecond();
        }
      },
    });

    await start(subject);
    await secondBroadcast;

    expect(seen).toEqual(['starting', 'from-broadcast']);
    expect(await subject.getState()).toMatchObject({ stage: 'from-broadcast' });
  }, 1_000);

  it('a rejecting broadcast cannot reject persistence or finalization', async () => {
    const store = deferredStore();
    const clock = fixedClock();
    const reports = new RunReportStore(store);
    const subject = new RunCoordinator({
      store,
      clock,
      reports,
      createId: () => 'rejecting-broadcast-run',
      broadcast: async () => {
        throw new Error('panel unavailable');
      },
    });

    const started = await start(subject);
    await subject.recordOutcome(started.runId, 'profile_views', {
      executed: 1,
      reason: 'done',
    });
    const report = await subject.finalize(started.runId, 'completed');

    expect(report?.id).toBe(started.runId);
    expect(await reports.list()).toHaveLength(1);
    expect(await subject.getState()).toMatchObject({
      running: false,
      phase: 'finished',
    });
  });

  it('keeps finalization reason stable after stop', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    await subject.requestStop(started.runId, 'manual');

    const report = await subject.finalize(started.runId, 'error');

    expect(report?.stopReason).toBe('manual');
  });

  it('ignores mutations with an unsupported risk marker at the typed boundary', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    const marker: RiskMarker = 'challenge';
    const reason: StopReason = 'risk';

    await subject.recordRisk(started.runId, marker);
    await subject.requestStop(started.runId, reason);

    expect(await subject.getState()).toMatchObject({
      riskMarkers: [marker],
      stopReason: reason,
    });
  });

  it('starts every new run with an empty v1 effect ledger', async () => {
    const { subject } = coordinator();
    await start(subject);

    expect((await subject.getState())?.effectLedger).toEqual({
      version: 1,
      active: {},
      receipts: {},
    });
  });

  it('resumes a lost reserved response only for the same request and exact descriptor', async () => {
    const { subject } = coordinator();
    const started = await start(subject);

    const first = await reserve(subject, started.runId, 'effect-request-1', likeEffect());
    const revision = (await subject.getState())?.revision;
    const resumed = await subject.reserveEffect(started.runId, 'effect-request-1', likeEffect());
    const mismatched = await subject.reserveEffect(
      started.runId,
      'effect-request-1',
      likeEffect('changed'),
    );
    const sameTarget = await subject.reserveEffect(started.runId, 'effect-request-2', likeEffect());

    expect(first).toMatchObject({ kind: 'reserved', canExecute: true });
    expect(resumed).toMatchObject({
      kind: 'resumed',
      canExecute: true,
      effectId: first.effectId,
    });
    expect(mismatched).toMatchObject({
      kind: 'identity',
      canExecute: false,
      effectId: first.effectId,
    });
    expect(sameTarget).toMatchObject({
      kind: 'duplicate-target',
      canExecute: false,
      effectId: first.effectId,
    });
    expect((await subject.getState())?.revision).toBe(revision);
    expect(Object.keys((await subject.getState())?.effectLedger?.active ?? {})).toEqual([
      first.effectId,
    ]);
  });

  it('canonicalizes request and attempt ids so whitespace retries keep ownership', async () => {
    const { subject } = coordinator();
    const started = await start(subject);

    const first = await reserve(subject, started.runId, ' effect-request ', likeEffect());
    expect(
      await subject.reserveEffect(started.runId, ' effect-request ', likeEffect()),
    ).toMatchObject({
      kind: 'resumed',
      canExecute: true,
      effectId: first.effectId,
    });
    expect(
      await subject.commitEffect(
        started.runId,
        ` ${first.effectId} `,
        ' effect-request ',
        ' attempt-owner ',
      ),
    ).toMatchObject({
      kind: 'committed',
      admitted: true,
      lease: { requestId: 'effect-request', commitAttemptId: 'attempt-owner' },
    });
    expect(
      await subject.commitEffect(
        started.runId,
        ` ${first.effectId} `,
        ' effect-request ',
        ' attempt-owner ',
      ),
    ).toMatchObject({ kind: 'already-committed', admitted: true });
    expect(
      await subject.settleEffect(
        started.runId,
        ` ${first.effectId} `,
        ' effect-request ',
        'confirmed',
        { attemptId: ' attempt-owner ' },
      ),
    ).toMatchObject({
      kind: 'settled',
      receipt: {
        requestId: 'effect-request',
        commitAttemptId: 'attempt-owner',
      },
    });
  });

  it('keeps ledger timestamps monotonic when the wall clock moves backward', async () => {
    const { subject, clock } = coordinator();
    const started = await start(subject);
    const committed = await reserve(
      subject,
      started.runId,
      'commit-request',
      likeEffect('committed'),
    );
    const reserved = await reserve(
      subject,
      started.runId,
      'reserve-request',
      likeEffect('reserved'),
    );

    clock.set('2026-08-11T09:00:00.000Z');
    expect(
      await subject.commitEffect(
        started.runId,
        committed.effectId,
        'commit-request',
        'commit-attempt',
      ),
    ).toMatchObject({
      kind: 'committed',
      lease: { committedAt: '2026-08-11T10:00:00.000Z' },
    });
    expect(
      await subject.settleEffect(started.runId, committed.effectId, 'commit-request', 'confirmed', {
        attemptId: 'commit-attempt',
      }),
    ).toMatchObject({
      kind: 'settled',
      receipt: { settledAt: '2026-08-11T10:00:00.000Z' },
    });
    await subject.requestStop(started.runId, 'manual');

    expect(await subject.pendingEffects(started.runId)).not.toHaveProperty('blocked');
    expect((await subject.getState())?.effectLedger?.receipts[reserved.effectId]).toMatchObject({
      outcome: 'cancelled',
      settledAt: '2026-08-11T10:00:00.000Z',
    });
  });

  it('admits exactly one commit attempt and fences every different executor', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    const effect = await reserve(subject, started.runId, 'effect-request', likeEffect());

    const [first, second] = await Promise.all([
      subject.commitEffect(started.runId, effect.effectId, 'effect-request', 'attempt-a'),
      subject.commitEffect(started.runId, effect.effectId, 'effect-request', 'attempt-b'),
    ]);

    expect(first).toMatchObject({
      kind: 'committed',
      admitted: true,
      lease: { commitAttemptId: 'attempt-a' },
    });
    expect(second).toEqual({
      kind: 'rejected',
      admitted: false,
      reason: 'attempt',
    });
  });

  it('re-admits only the owning attempt after a lost commit response and STOP', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    const effect = await reserve(subject, started.runId, 'effect-request', likeEffect());

    await subject.commitEffect(started.runId, effect.effectId, 'effect-request', 'attempt-owner');
    await subject.requestStop(started.runId, 'manual');

    expect(
      await subject.commitEffect(started.runId, effect.effectId, 'effect-request', 'attempt-owner'),
    ).toMatchObject({
      kind: 'already-committed',
      admitted: true,
      lease: { commitAttemptId: 'attempt-owner' },
    });
    expect(
      await subject.commitEffect(started.runId, effect.effectId, 'effect-request', 'attempt-other'),
    ).toEqual({
      kind: 'rejected',
      admitted: false,
      reason: 'attempt',
    });
  });

  it('requires the owning attempt to settle committed effects but lets reserved failures close', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    const committed = await reserve(
      subject,
      started.runId,
      'committed-request',
      likeEffect('committed'),
    );
    const reserved = await reserve(
      subject,
      started.runId,
      'reserved-request',
      likeEffect('reserved'),
    );
    await subject.commitEffect(
      started.runId,
      committed.effectId,
      'committed-request',
      'attempt-owner',
    );

    expect(
      await subject.settleEffect(
        started.runId,
        committed.effectId,
        'committed-request',
        'confirmed',
      ),
    ).toEqual({
      kind: 'rejected',
      reason: 'attempt',
    });
    expect(
      await subject.settleEffect(
        started.runId,
        committed.effectId,
        'committed-request',
        'confirmed',
        { attemptId: 'attempt-other' },
      ),
    ).toEqual({ kind: 'rejected', reason: 'attempt' });
    expect(
      await subject.settleEffect(
        started.runId,
        committed.effectId,
        'committed-request',
        'confirmed',
        { attemptId: 'attempt-owner' },
      ),
    ).toMatchObject({
      kind: 'settled',
      receipt: { commitAttemptId: 'attempt-owner', outcome: 'confirmed' },
    });
    const reservedFailure = await subject.settleEffect(
      started.runId,
      reserved.effectId,
      'reserved-request',
      'failed',
    );
    expect(reservedFailure).toMatchObject({
      kind: 'settled',
      receipt: { outcome: 'failed' },
    });
    if (reservedFailure.kind === 'rejected') throw new Error(reservedFailure.reason);
    expect(reservedFailure.receipt).not.toHaveProperty('commitAttemptId');
  });

  it('rejects an unknown runtime outcome without poisoning the persisted ledger', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    const effect = await reserve(subject, started.runId, 'effect-request', likeEffect());
    const before = await subject.getState();

    expect(
      await subject.settleEffect(
        started.runId,
        effect.effectId,
        'effect-request',
        'garbage' as never,
      ),
    ).toEqual({ kind: 'rejected', reason: 'invalid' });
    expect(await subject.getState()).toBe(before);
    expect(await subject.pendingEffects(started.runId)).not.toHaveProperty('blocked');
  });

  it('sanitizes a runtime descriptor so action text can never enter persistence', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    const unsafe = {
      ...likeEffect(),
      comment: 'secret generated text',
      post: 'secret post',
    } as unknown as EffectDescriptor;

    const result = await reserve(subject, started.runId, 'effect-request-1', unsafe);
    const persisted = JSON.stringify((await subject.getState())?.effectLedger);

    expect(result.kind).toBe('reserved');
    expect(persisted).not.toContain('secret');
    expect(persisted).not.toContain('comment');
  });

  it('serializes commit before stop: committed survives while reserved is cancelled/applied', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    const committed = await reserve(
      subject,
      started.runId,
      'commit-request',
      likeEffect('committed'),
    );
    const reserved = await reserve(
      subject,
      started.runId,
      'reserve-request',
      likeEffect('reserved'),
    );

    const [commitResult] = await Promise.all([
      subject.commitEffect(started.runId, committed.effectId, 'commit-request', 'commit-attempt'),
      subject.requestStop(started.runId, 'manual'),
    ]);

    expect(commitResult).toMatchObject({ kind: 'committed', admitted: true });
    const ledger = (await subject.getState())?.effectLedger;
    expect(ledger?.active[committed.effectId]?.stage).toBe('committed');
    expect(ledger?.active[reserved.effectId]).toBeUndefined();
    expect(ledger?.receipts[reserved.effectId]).toMatchObject({
      outcome: 'cancelled',
      accounting: 'applied',
    });
    expect(
      await subject.commitEffect(
        started.runId,
        committed.effectId,
        'commit-request',
        'commit-attempt',
      ),
    ).toMatchObject({
      kind: 'already-committed',
      admitted: true,
      lease: { effectId: committed.effectId },
    });
  });

  it('serializes stop before commit: the reserved lease loses admission', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    const effect = await reserve(subject, started.runId, 'effect-request', likeEffect());

    const [, commit] = await Promise.all([
      subject.requestStop(started.runId, 'manual'),
      subject.commitEffect(started.runId, effect.effectId, 'effect-request', 'effect-attempt'),
    ]);

    expect(commit).toEqual({
      kind: 'rejected',
      admitted: false,
      reason: 'inactive',
    });
    expect((await subject.getState())?.effectLedger?.receipts[effect.effectId]).toMatchObject({
      outcome: 'cancelled',
      accounting: 'applied',
    });
  });

  it('makes committed admission retry idempotent and lets failed/cancelled close reserved leases', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    const committed = await reserve(
      subject,
      started.runId,
      'commit-request',
      likeEffect('committed'),
    );
    const failed = await reserve(subject, started.runId, 'failed-request', likeEffect('failed'));
    const cancelled = await reserve(
      subject,
      started.runId,
      'cancelled-request',
      likeEffect('cancelled'),
    );

    const first = await subject.commitEffect(
      started.runId,
      committed.effectId,
      'commit-request',
      'commit-attempt',
    );
    const revision = (await subject.getState())?.revision;
    const retry = await subject.commitEffect(
      started.runId,
      committed.effectId,
      'commit-request',
      'commit-attempt',
    );
    const failedResult = await subject.settleEffect(
      started.runId,
      failed.effectId,
      'failed-request',
      'failed',
    );
    const cancelledResult = await subject.settleEffect(
      started.runId,
      cancelled.effectId,
      'cancelled-request',
      'cancelled',
    );

    expect(first.kind).toBe('committed');
    expect(retry.kind).toBe('already-committed');
    expect((await subject.getState())?.revision).toBe((revision ?? 0) + 2);
    expect(failedResult).toMatchObject({
      kind: 'settled',
      receipt: { outcome: 'failed' },
    });
    expect(cancelledResult).toMatchObject({
      kind: 'settled',
      receipt: { outcome: 'cancelled' },
    });
  });

  it('settles a committed effect after stop and accounts a like exactly once under concurrency', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    const effect = await reserve(subject, started.runId, 'effect-request', likeEffect());
    await subject.commitEffect(started.runId, effect.effectId, 'effect-request', 'effect-attempt');
    await subject.requestStop(started.runId, 'manual');

    const settled = await Promise.all([
      subject.settleEffect(started.runId, effect.effectId, 'effect-request', 'confirmed', {
        attemptId: 'effect-attempt',
      }),
      subject.settleEffect(started.runId, effect.effectId, 'effect-request', 'confirmed', {
        attemptId: 'effect-attempt',
      }),
    ]);

    expect(settled.map((result) => result.kind)).toEqual(['settled', 'duplicate']);
    expect(await subject.getState()).toMatchObject({
      used: 8,
      actionTimestamps: [Date.parse('2026-08-11T10:00:00Z')],
    });
    expect((await subject.getState())?.effectLedger?.receipts[effect.effectId]).toMatchObject({
      outcome: 'confirmed',
      accounting: 'pending',
    });
  });

  it('allows only uncertain → confirmed before finish, without a second safety spend', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    const effect = await reserve(subject, started.runId, 'effect-request', likeEffect());
    await subject.commitEffect(started.runId, effect.effectId, 'effect-request', 'effect-attempt');
    const uncertain = await subject.settleEffect(
      started.runId,
      effect.effectId,
      'effect-request',
      'uncertain',
      {
        attemptId: 'effect-attempt',
        reason: 'channel_closed',
      },
    );
    if (uncertain.kind === 'rejected') throw new Error(uncertain.reason);
    await subject.markEffectAccounted(started.runId, effect.effectId, {
      settledAt: uncertain.receipt.settledAt,
      outcome: 'uncertain',
    });

    const upgraded = await subject.settleEffect(
      started.runId,
      effect.effectId,
      'effect-request',
      'confirmed',
      {
        attemptId: 'effect-attempt',
      },
    );
    expect(
      await subject.markEffectAccounted(started.runId, effect.effectId, {
        settledAt: uncertain.receipt.settledAt,
        outcome: 'uncertain',
      }),
    ).toBeNull();
    const weaker = await subject.settleEffect(
      started.runId,
      effect.effectId,
      'effect-request',
      'failed',
      {
        attemptId: 'effect-attempt',
      },
    );

    expect(upgraded).toMatchObject({
      kind: 'upgraded',
      receipt: { outcome: 'confirmed', accounting: 'pending' },
    });
    if (upgraded.kind === 'rejected') throw new Error(upgraded.reason);
    expect(upgraded.receipt.reason).toBeUndefined();
    expect(weaker).toMatchObject({
      kind: 'duplicate',
      receipt: { outcome: 'confirmed' },
    });
    expect((await subject.getState())?.used).toBe(8);
  });

  it('rejects an uncertain → confirmed upgrade after the run is finished', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    const effect = await reserve(subject, started.runId, 'effect-request', likeEffect());
    await subject.commitEffect(started.runId, effect.effectId, 'effect-request', 'effect-attempt');
    await subject.settleEffect(started.runId, effect.effectId, 'effect-request', 'uncertain', {
      attemptId: 'effect-attempt',
    });
    await markAccounted(subject, started.runId, effect.effectId);
    await subject.finalize(started.runId, 'completed');

    expect(
      await subject.settleEffect(started.runId, effect.effectId, 'effect-request', 'confirmed', {
        attemptId: 'effect-attempt',
      }),
    ).toEqual({
      kind: 'rejected',
      reason: 'finished',
    });
    expect((await subject.getState())?.used).toBe(8);
  });

  it('rejects stale-run effect mutations and blocks finalize until committed/accounting work drains', async () => {
    const { subject } = coordinator();
    const old = await start(subject);
    const effect = await reserve(subject, old.runId, 'effect-request', likeEffect());
    await subject.commitEffect(old.runId, effect.effectId, 'effect-request', 'effect-attempt');

    expect(await subject.finalize(old.runId, 'completed')).toBeNull();
    await subject.settleEffect(old.runId, effect.effectId, 'effect-request', 'confirmed', {
      attemptId: 'effect-attempt',
    });
    expect(await subject.finalize(old.runId, 'completed')).toBeNull();
    await markAccounted(subject, old.runId, effect.effectId);
    expect((await subject.finalize(old.runId, 'completed'))?.id).toBe(old.runId);

    const current = await start(subject, 'request-2');
    expect(await subject.reserveEffect(old.runId, 'late', likeEffect('late'))).toEqual({
      kind: 'inactive',
      canExecute: false,
    });
    expect((await subject.getState())?.runId).toBe(current.runId);
  });

  it('reconciles persisted leases after restart: reserved cancels, committed can expire uncertain', async () => {
    const store = deferredStore();
    const first = coordinator(store);
    const started = await start(first.subject);
    const reserved = await reserve(
      first.subject,
      started.runId,
      'reserved-request',
      likeEffect('reserved'),
    );
    const committed = await reserve(
      first.subject,
      started.runId,
      'committed-request',
      likeEffect('committed'),
    );
    await first.subject.commitEffect(
      started.runId,
      committed.effectId,
      'committed-request',
      'committed-attempt',
    );

    const restarted = coordinator(store, first.clock);
    const reconciled = await restarted.subject.reconcileEffects(started.runId);
    let pending = await restarted.subject.pendingEffects(started.runId);
    expect(reconciled.cancelled.map((receipt) => receipt.effectId)).toEqual([reserved.effectId]);
    expect(pending?.committed.map((lease) => lease.effectId)).toEqual([committed.effectId]);

    const expired = await restarted.subject.expireCommittedEffects(started.runId);
    pending = await restarted.subject.pendingEffects(started.runId);
    expect(expired).toMatchObject([
      {
        effectId: committed.effectId,
        outcome: 'uncertain',
        accounting: 'pending',
      },
    ]);
    expect(pending).toMatchObject({
      committed: [],
      accounting: [{ effectId: committed.effectId }],
    });
  });

  it('normalizes a legacy missing ledger only when the first effect mutation needs it', async () => {
    const store = deferredStore();
    const { subject } = coordinator(store);
    const started = await start(subject);
    const state = await subject.getState();
    if (!state) throw new Error('missing state');
    const { effectLedger: _ledger, ...legacy } = state;
    await store.set(AUTOPILOT_STATE_KEY, legacy);

    await subject.reconcileEffects(started.runId);
    expect((await subject.getState())?.effectLedger).toBeUndefined();

    const effect = await reserve(subject, started.runId, 'effect-request', likeEffect());

    expect(effect.kind).toBe('reserved');
    expect((await subject.getState())?.effectLedger).toMatchObject({
      version: 1,
      active: { [effect.effectId]: {} },
    });
  });

  it('fails closed and preserves an unsupported ledger without any write', async () => {
    const store = deferredStore();
    const { subject } = coordinator(store);
    const started = await start(subject);
    const before = await subject.getState();
    if (!before) throw new Error('missing state');
    const future = { version: 2, active: { opaque: true }, receipts: {} };
    await store.set(AUTOPILOT_STATE_KEY, {
      ...before,
      effectLedger: future,
    } as unknown as AutopilotState);
    const revision = before.revision;

    expect(
      await subject.reserveEffect(started.runId, 'future-request', likeEffect('future')),
    ).toEqual({
      kind: 'ledger-error',
      canExecute: false,
      error: 'unsupported-version',
    });
    expect(
      await subject.commitEffect(started.runId, 'opaque', 'future-request', 'future-attempt'),
    ).toEqual({
      kind: 'rejected',
      admitted: false,
      reason: 'ledger-error',
      error: 'unsupported-version',
    });
    expect(
      await subject.settleEffect(started.runId, 'opaque', 'future-request', 'confirmed', {
        attemptId: 'future-attempt',
      }),
    ).toEqual({
      kind: 'rejected',
      reason: 'ledger-error',
      error: 'unsupported-version',
    });
    expect(
      await subject.markEffectAccounted(started.runId, 'opaque', {
        settledAt: '2026-08-11T10:00:00.000Z',
        outcome: 'confirmed',
      }),
    ).toBeNull();
    expect(await subject.expireCommittedEffects(started.runId)).toEqual([]);
    expect(await subject.pendingEffects(started.runId)).toMatchObject({
      committed: [],
      accounting: [],
      blocked: 'unsupported-version',
    });
    expect(await subject.reconcileEffects(started.runId)).toMatchObject({
      cancelled: [],
      expired: [],
      blocked: 'unsupported-version',
    });
    expect(await subject.finalize(started.runId, 'completed')).toBeNull();

    const after = await subject.getState();
    expect(after?.effectLedger).toBe(future);
    expect(after?.revision).toBe(revision);
  });

  it('quarantines malformed v1 identity instead of dropping it during finalization', async () => {
    const store = deferredStore();
    const { subject } = coordinator(store);
    const started = await start(subject);
    const before = await subject.getState();
    if (!before) throw new Error('missing state');
    const malformed = {
      version: 1,
      active: {
        broken: {
          effectId: 'wrong-key',
          requestId: 'request',
          descriptor: likeEffect(),
          stage: 'reserved',
          reservedAt: '2026-08-11T10:00:00.000Z',
        },
      },
      receipts: {},
    };
    await store.set(AUTOPILOT_STATE_KEY, {
      ...before,
      effectLedger: malformed as unknown as EffectLedgerV1,
    });

    expect(await subject.finalize(started.runId, 'completed')).toBeNull();
    expect((await subject.getState())?.effectLedger).toBe(malformed);
  });

  it('builds ledger-backed reports from confirmed/failed receipts without moduleOutcome double-counting', async () => {
    const { subject } = coordinator();
    const started = await start(subject);
    await subject.recordOutcome(started.runId, 'engagement', {
      executed: 99,
      skipped: 2,
      failed: 9,
      reason: 'feed_exhausted',
    });
    for (const [index, outcome] of (['confirmed', 'uncertain', 'already'] as const).entries()) {
      const requestId = `effect-request-${index}`;
      const effect = await reserve(subject, started.runId, requestId, likeEffect(`urn:${index}`));
      const attemptId = `${requestId}:attempt`;
      await subject.commitEffect(started.runId, effect.effectId, requestId, attemptId);
      await subject.settleEffect(started.runId, effect.effectId, requestId, outcome, { attemptId });
      await markAccounted(subject, started.runId, effect.effectId);
    }

    const report = await subject.finalize(started.runId, 'completed');

    expect(report?.modules).toEqual([
      {
        id: 'engagement',
        executed: 1,
        skipped: 2,
        failed: 1,
        reason: 'feed_exhausted',
      },
    ]);
  });
});
