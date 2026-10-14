import { describe, expect, it } from 'vitest';
import { normalizeSchedule, scheduleLocalDay, shouldStartScheduledRun } from './weekdayRun';

const base = {
  schedule: { enabled: true, hour: 10 },
  paused: false,
  alreadyRanOn: null as string | null,
  running: false,
};

describe('weekday schedule', () => {
  it('starts once on a weekday after the chosen hour', () => {
    const wednesday = new Date(2026, 7, 12, 10, 5);
    expect(wednesday.getDay()).toBe(3);
    expect(shouldStartScheduledRun({ ...base, now: wednesday })).toBe(true);
    expect(
      shouldStartScheduledRun({
        ...base,
        now: wednesday,
        alreadyRanOn: scheduleLocalDay(wednesday),
      }),
    ).toBe(false);
    expect(shouldStartScheduledRun({ ...base, now: new Date(2026, 7, 12, 9, 0) })).toBe(false);
  });

  it('skips weekends, pause, and a run that is already going', () => {
    const saturday = new Date(2026, 7, 15, 12, 0);
    expect(saturday.getDay()).toBe(6);
    expect(shouldStartScheduledRun({ ...base, now: saturday })).toBe(false);
    expect(shouldStartScheduledRun({ ...base, now: new Date(2026, 7, 12, 12), paused: true })).toBe(
      false,
    );
    expect(
      shouldStartScheduledRun({ ...base, now: new Date(2026, 7, 12, 12), running: true }),
    ).toBe(false);
  });

  it('defaults to off at 10:00', () => {
    expect(normalizeSchedule(null)).toEqual({ enabled: false, hour: 10 });
    expect(normalizeSchedule({ enabled: true, hour: 27 })).toEqual({ enabled: true, hour: 10 });
  });
});
