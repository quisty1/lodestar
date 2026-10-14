import { moduleLimit } from '../engagement/settings';

/** Default likes/day when the engagement module has no configured limit. */
export const DEFAULT_LIKES_PER_DAY = 35;

/**
 * The configured likes/day for the engagement module — the BASE for the autopilot
 * daily ceiling (DailyCeiling then applies ± jitter + warmup). Reads from the
 * persisted modules:state roster (via the shared moduleLimit reader).
 */
export function engagementLimit(modulesState: unknown): number {
  return moduleLimit(modulesState, 'engagement', DEFAULT_LIKES_PER_DAY);
}
