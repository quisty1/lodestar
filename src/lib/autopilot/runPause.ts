export const RUN_PAUSE_KEY = 'autopilot:pausedUntil';

/** Pause is active while today's local date is strictly before the stored day. */
export function isPausedUntil(value: unknown, today: string): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value > today;
}

export function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function tomorrowKey(now: Date): string {
  const next = new Date(now.getTime());
  next.setDate(next.getDate() + 1);
  return localDay(next);
}
