import type { PersonCandidate } from '../types';

/** Fresh (not-yet-sent) candidates, capped to this run's allowance. Pure. */
export function selectCandidates(
  harvested: PersonCandidate[],
  sent: Set<string>,
  cap: number,
): PersonCandidate[] {
  return harvested.filter((c) => !sent.has(c.memberId)).slice(0, Math.max(0, cap));
}
