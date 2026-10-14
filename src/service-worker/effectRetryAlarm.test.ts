import { describe, expect, it, vi } from 'vitest';
import { RunCoordinator } from '@lib/autopilot/RunCoordinator';
import { RunReportStore } from '@lib/autopilot/RunReportStore';
import { FakeStore } from '@lib/storage/fakeStore';
import { EffectRunFinalizer } from './EffectRunFinalizer';
import {
  EFFECT_RETRY_ALARM,
  recoverEffectRetry,
  registerEffectRetryAlarm,
} from './effectRetryAlarm';

describe('registered durable effect retry alarm boundary', () => {
  it('wakes a replacement worker and stores exactly one report after an incomplete drain', async () => {
    let alarmListener: ((alarm: { name: string }) => void) | undefined;
    const create = vi.fn();
    const clear = vi.fn(async () => true);
    const store = new FakeStore();
    const reports = new RunReportStore(store);
    const clock = { now: () => new Date('2026-08-11T10:00:00.000Z') };
    const coordinator = new RunCoordinator({
      store,
      reports,
      clock,
      createId: () => 'run-1',
    });
    const begun = await coordinator.begin({
      requestId: 'start-1',
      host: 'tab',
      day: '2026-08-11',
      ceiling: 10,
      used: 0,
    });
    if (begun.kind !== 'started') throw new Error(begun.kind);
    const broadcastReport = vi.fn();
    let replacement!: EffectRunFinalizer;
    const alarm = registerEffectRetryAlarm(
      {
        alarms: {
          create,
          clear,
          onAlarm: {
            addListener: (listener) => {
              alarmListener = listener;
            },
          },
        },
      },
      {
        now: () => Date.parse('2026-08-11T10:00:00.000Z'),
        recover: () =>
          recoverEffectRetry({
            getState: () => coordinator.getState(),
            finish: (runId, state) => replacement.finish(runId, state),
            clear: () => {
              alarm.clear();
            },
          }),
      },
    );
    const firstWorker = new EffectRunFinalizer({
      requestStop: (runId, reason) => coordinator.requestStop(runId, reason),
      reconcile: async () => undefined,
      stopContent: async () => undefined,
      clearActivity: async () => undefined,
      drain: () => new Promise(() => {}),
      finalize: (runId) => coordinator.finalize(runId),
      broadcastReport,
      scheduleRetry: () => undefined,
      scheduleDurableRetry: (_runId, delayMs) => {
        alarm.schedule(delayMs);
      },
      clearDurableRetry: () => {
        alarm.clear();
      },
    });

    await firstWorker.request(begun.runId, 'manual');
    expect(create).toHaveBeenCalledWith(EFFECT_RETRY_ALARM, {
      when: Date.parse('2026-08-11T10:01:00.000Z'),
    });

    replacement = new EffectRunFinalizer({
      requestStop: (runId, reason) => coordinator.requestStop(runId, reason),
      reconcile: (runId) => coordinator.reconcileEffects(runId),
      stopContent: async () => undefined,
      clearActivity: async () => undefined,
      drain: async () => ({ drained: true, timedOut: false, expired: 0 }),
      finalize: (runId) => coordinator.finalize(runId),
      broadcastReport,
      scheduleDurableRetry: (_runId, delayMs) => {
        alarm.schedule(delayMs);
      },
      clearDurableRetry: () => {
        alarm.clear();
      },
    });
    alarmListener!({ name: EFFECT_RETRY_ALARM });
    await vi.waitFor(async () => {
      expect(await reports.list()).toHaveLength(1);
    });

    expect(broadcastReport).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledWith(EFFECT_RETRY_ALARM);

    replacement = new EffectRunFinalizer({
      requestStop: (runId, reason) => coordinator.requestStop(runId, reason),
      stopContent: async () => undefined,
      clearActivity: async () => undefined,
      drain: async () => ({ drained: true, timedOut: false, expired: 0 }),
      finalize: (runId) => coordinator.finalize(runId),
      broadcastReport,
    });
    alarmListener!({ name: EFFECT_RETRY_ALARM });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(broadcastReport).toHaveBeenCalledOnce();
  });
});
