export const SCHEDULE_KEY = 'schedule:settings';
export const SCHEDULE_LAST_KEY = 'schedule:lastDay';
export const WEEKDAY_ALARM = 'lodestar:weekday-run';

export interface WeekdaySchedule {
  enabled: boolean;
  /** Local hour 0–23. The run starts once that hour has been reached. */
  hour: number;
}

export function normalizeSchedule(raw: unknown): WeekdaySchedule {
  const record =
    raw && typeof raw === 'object' ? (raw as { enabled?: unknown; hour?: unknown }) : {};
  const hour =
    typeof record.hour === 'number' && record.hour >= 0 && record.hour <= 23
      ? Math.floor(record.hour)
      : 10;
  return { enabled: record.enabled === true, hour };
}

export function shouldStartScheduledRun(args: {
  schedule: WeekdaySchedule;
  now: Date;
  paused: boolean;
  alreadyRanOn: string | null;
  running: boolean;
}): boolean {
  if (!args.schedule.enabled || args.paused || args.running) return false;
  const day = args.now.getDay();
  if (day === 0 || day === 6) return false;
  if (args.now.getHours() < args.schedule.hour) return false;
  const today = localDay(args.now);
  return args.alreadyRanOn !== today;
}

function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export { localDay as scheduleLocalDay };
