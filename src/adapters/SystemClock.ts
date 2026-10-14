import type { Clock } from '@lib/ports';

/** Production clock. Thin edge adapter — no logic to unit-test. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
