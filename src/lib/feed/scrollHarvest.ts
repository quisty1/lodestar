import { FeedAccumulator } from './FeedAccumulator';
import { ScrollHarvestPolicy } from './ScrollHarvestPolicy';
import type { FeedPost } from '../types';

export interface ScrollHarvestDeps {
  /** Parse the currently-rendered feed. */
  parse: () => FeedPost[];
  /** Scroll to the bottom to trigger LinkedIn's lazy-load. */
  scrollToBottom: () => void;
  /** Human-like read pause between rounds (caller owns the jitter). */
  sleep: () => Promise<void>;
  /**
   * Abort mid-scroll (e.g. an autopilot STOP). Defaults to never-abort so a
   * STANDALONE harvest (manual "Generate ideas", no run active) still collects —
   * previously this read the run flag directly and returned nothing when no run
   * was active.
   */
  shouldAbort?: () => boolean;
}

/**
 * Scroll-driven feed harvest: parse → scroll → wait, until `target` posts are
 * collected, the feed goes stale (maxStaleRounds), or maxRounds. Pure orchestration
 * (all I/O injected) → unit-tested.
 */
export async function scrollHarvest(target: number, deps: ScrollHarvestDeps): Promise<FeedPost[]> {
  const acc = new FeedAccumulator();
  // LinkedIn lazy-loads on scroll and can be slow: 3 empty rounds before concluding
  // the feed is exhausted.
  const policy = new ScrollHarvestPolicy({ maxStaleRounds: 3, maxRounds: 20 });
  const shouldAbort = deps.shouldAbort ?? (() => false);
  let staleRounds = 0;
  for (let round = 0; ; round++) {
    if (shouldAbort()) break;
    const added = acc.add(deps.parse());
    staleRounds = added > 0 ? 0 : staleRounds + 1;
    if (policy.shouldStop({ collected: acc.size(), target, staleRounds, round })) break;
    deps.scrollToBottom();
    await deps.sleep();
  }
  return acc.items().slice(0, target);
}
