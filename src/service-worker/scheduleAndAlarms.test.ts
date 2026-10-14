import { describe, expect, it, vi } from 'vitest';
import { FakeStore } from '@lib/storage/fakeStore';
import { RUN_PAUSE_KEY } from '@lib/autopilot/runPause';
import { SCHEDULE_KEY, SCHEDULE_LAST_KEY, WEEKDAY_ALARM } from '@lib/schedule/weekdayRun';
import { REFRESH_ALARM } from './extensionStartup';
import { registerScheduleAndAlarms } from './scheduleAndAlarms';
import type { createAutopilotStart } from './autopilotStart';
import type { WorkerContext } from './workerContext';

type StartAutopilot = ReturnType<typeof createAutopilotStart>;

function harness(now: Date) {
  const store = new FakeStore();
  const refreshMetricsIfDue = vi.fn();
  const start = vi.fn(async (): Promise<{ ok: boolean }> => ({ ok: true }));
  const installed: Array<() => void> = [];
  const startups: Array<() => void> = [];
  const alarms: Array<(alarm: { name: string }) => void> = [];
  const created: string[] = [];
  const known = new Set<string>();
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onInstalled: { addListener: (fn: () => void) => installed.push(fn) },
      onStartup: { addListener: (fn: () => void) => startups.push(fn) },
    },
    alarms: {
      get: vi.fn(async (name: string) => (known.has(name) ? { name } : undefined)),
      create: vi.fn(async (name: string) => {
        known.add(name);
        created.push(name);
      }),
      onAlarm: { addListener: (fn: (alarm: { name: string }) => void) => alarms.push(fn) },
    },
    notifications: { create: vi.fn() },
  });
  const ctx = {
    store,
    clock: { now: () => now },
    coordinator: { getState: async () => ({ running: false }) },
    refreshMetricsIfDue,
  } as unknown as WorkerContext;
  registerScheduleAndAlarms(ctx, start as unknown as StartAutopilot);
  return { store, start, installed, startups, alarms, created, refreshMetricsIfDue };
}

describe('registerScheduleAndAlarms', () => {
  it('creates the weekday alarm once', async () => {
    const { created, installed } = harness(new Date(2026, 9, 8, 11));
    await vi.waitFor(() => {
      expect(created).toEqual([WEEKDAY_ALARM]);
    });
    installed[0]?.();
    await Promise.resolve();
    expect(created).toEqual([WEEKDAY_ALARM]);
  });

  it('starts a weekday run once the scheduled hour has passed', async () => {
    const { store, start, alarms } = harness(new Date(2026, 9, 8, 11));
    await store.set(SCHEDULE_KEY, { enabled: true, hour: 10 });
    alarms[0]?.({ name: WEEKDAY_ALARM });
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledWith('tab');
    });
    expect(await store.get(SCHEDULE_LAST_KEY)).toBe('2026-10-08');
  });

  it('skips a paused day and clears the stamp when start fails', async () => {
    const paused = harness(new Date(2026, 9, 8, 11));
    await paused.store.set(SCHEDULE_KEY, { enabled: true, hour: 10 });
    await paused.store.set(RUN_PAUSE_KEY, '2026-10-09');
    paused.alarms[0]?.({ name: WEEKDAY_ALARM });
    await Promise.resolve();
    expect(paused.start).not.toHaveBeenCalled();

    const failed = harness(new Date(2026, 9, 8, 11));
    failed.start.mockResolvedValue({ ok: false });
    await failed.store.set(SCHEDULE_KEY, { enabled: true, hour: 10 });
    failed.alarms[0]?.({ name: WEEKDAY_ALARM });
    await vi.waitFor(() => {
      expect(failed.start).toHaveBeenCalled();
    });
    expect(await failed.store.get(SCHEDULE_LAST_KEY)).toBe('');
    expect(chrome.notifications.create).toHaveBeenCalled();
  });

  it('refreshes metrics on the refresh alarm and on startup', () => {
    const { alarms, startups, refreshMetricsIfDue } = harness(new Date(2026, 9, 8, 11));
    alarms[0]?.({ name: REFRESH_ALARM });
    startups[0]?.();
    expect(refreshMetricsIfDue).toHaveBeenCalledTimes(2);
  });

  it('does not start on the weekend', async () => {
    const { store, start, alarms } = harness(new Date(2026, 9, 10, 11));
    await store.set(SCHEDULE_KEY, { enabled: true, hour: 10 });
    alarms[0]?.({ name: WEEKDAY_ALARM });
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
  });
});
