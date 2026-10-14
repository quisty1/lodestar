import { moduleLimit } from '../engagement/settings';

/** Persisted day-keyed ideas/day counter (mirrors the autopilot daily budget). */
export interface IdeaDay {
  day: string;
  used: number;
}

export const IDEA_BUDGET_KEY = 'ideas:budget';
/** Persisted diagnostic of the most recent in-loop extraction (shared by SW writer + UI reader). */
export const IDEAS_LAST_RUN_KEY = 'ideas:lastRun';
export const DEFAULT_IDEAS_PER_DAY = 5;

/** The content module's ideas/day limit (via the shared moduleLimit reader). */
export function ideasPerDayLimit(modulesState: unknown): number {
  return moduleLimit(modulesState, 'content', DEFAULT_IDEAS_PER_DAY);
}

/** Same-day carry-over (don't re-grant); a new day resets used to 0. Pure. */
export function rolloverIdeaDay(prev: IdeaDay | null, today: string): IdeaDay {
  if (prev && prev.day === today) return prev;
  return { day: today, used: 0 };
}

export function recordIdeaDay(state: IdeaDay, n: number): IdeaDay {
  return { day: state.day, used: state.used + Math.max(0, n) };
}

export function remainingIdeas(state: IdeaDay, limit: number): number {
  return Math.max(0, limit - state.used);
}
