import type { AutopilotStatus } from '@lib/types';
import type { FeedPreparation } from './runTarget';

export interface StartContinuationDependencies {
  prepareFeed(runId: string): Promise<FeedPreparation>;
  isActive(runId: string): Promise<boolean>;
  prepareLaunch(): Promise<() => Promise<void>>;
  trackLaunch(runId: string, launch: Promise<void>): void;
  status(): Promise<AutopilotStatus>;
}

export type StartContinuationResult =
  | { kind: 'started'; status: AutopilotStatus }
  | { kind: 'preflight-failed'; reason: 'navigation_failed' | 'unsupported_dom' }
  | { kind: 'stale' };

/** Guards both async startup gaps before a detached launch can claim success. */
export async function continueAutopilotStart(
  runId: string,
  dependencies: StartContinuationDependencies,
): Promise<StartContinuationResult> {
  if (!(await dependencies.isActive(runId))) return { kind: 'stale' };
  const prepared = await dependencies.prepareFeed(runId);
  if (!prepared.ok) return { kind: 'preflight-failed', reason: prepared.reason };
  if (!(await dependencies.isActive(runId))) return { kind: 'stale' };

  const launch = await dependencies.prepareLaunch();
  if (!(await dependencies.isActive(runId))) return { kind: 'stale' };

  const task = launch();
  dependencies.trackLaunch(runId, task);
  const status = await dependencies.status();
  if (!(await dependencies.isActive(runId)) || !status.running || status.runId !== runId) {
    return { kind: 'stale' };
  }
  return { kind: 'started', status };
}
