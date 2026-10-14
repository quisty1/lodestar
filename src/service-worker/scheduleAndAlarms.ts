import { isPausedUntil, localDay, RUN_PAUSE_KEY } from '@lib/autopilot/runPause';
import {
  normalizeSchedule,
  SCHEDULE_KEY,
  SCHEDULE_LAST_KEY,
  shouldStartScheduledRun,
  WEEKDAY_ALARM,
} from '@lib/schedule/weekdayRun';
import { REFRESH_ALARM } from './extensionStartup';
import { notify } from './linkedinTabBridge';
import type { createAutopilotStart } from './autopilotStart';
import type { WorkerContext } from './workerContext';

type StartAutopilot = ReturnType<typeof createAutopilotStart>;

export function registerScheduleAndAlarms(
  ctx: WorkerContext,
  startAutopilot: StartAutopilot,
): void {
  chrome.runtime.onInstalled.addListener(() => {
    ctx.refreshMetricsIfDue();
    void ensureWeekdayAlarm();
  });
  void ensureWeekdayAlarm();
  chrome.runtime.onStartup.addListener(() => {
    ctx.refreshMetricsIfDue();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) ctx.refreshMetricsIfDue();
    if (alarm.name === WEEKDAY_ALARM) void maybeStartScheduledRun();
  });

  async function ensureWeekdayAlarm(): Promise<void> {
    if (await chrome.alarms.get(WEEKDAY_ALARM)) return;
    await chrome.alarms.create(WEEKDAY_ALARM, { periodInMinutes: 30 });
  }

  async function maybeStartScheduledRun(): Promise<void> {
    const [schedule, lastDay, paused, state] = await Promise.all([
      ctx.store.get(SCHEDULE_KEY),
      ctx.store.get<string>(SCHEDULE_LAST_KEY),
      ctx.store.get(RUN_PAUSE_KEY),
      ctx.coordinator.getState(),
    ]);
    const now = ctx.clock.now();
    if (
      !shouldStartScheduledRun({
        schedule: normalizeSchedule(schedule),
        now,
        paused: isPausedUntil(paused, localDay(now)),
        alreadyRanOn: typeof lastDay === 'string' ? lastDay : null,
        running: state?.running === true,
      })
    )
      return;
    await ctx.store.set(SCHEDULE_LAST_KEY, localDay(now));
    try {
      const started = await startAutopilot('tab');
      if (!started.ok) {
        await ctx.store.set(SCHEDULE_LAST_KEY, '');
        notify(
          'Lodestar не запустился сам',
          'Открой вкладку LinkedIn — расписание попробует ещё раз.',
        );
      }
    } catch {
      await ctx.store.set(SCHEDULE_LAST_KEY, '');
    }
  }
}
