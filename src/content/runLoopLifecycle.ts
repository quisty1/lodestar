import type { StopReason } from '@lib/types';
import type { ContentRunSession } from './runSession';

export interface ScopedContentLoopDependencies {
  session: ContentRunSession;
  execute(): Promise<void>;
  endRun(runId: string, reason: StopReason): Promise<void>;
  teardown(): Promise<void>;
  clearActivity(): void;
}

/** Contains failures and prevents a stale loop from tearing down a newer page-local run. */
export async function runScopedContentLoop(
  runId: string,
  dependencies: ScopedContentLoopDependencies,
): Promise<void> {
  try {
    await dependencies.execute();
  } catch {
    await reportOwnedError(runId, dependencies);
  } finally {
    if (!ownedByAnotherRun(runId, dependencies.session)) {
      try {
        await dependencies.teardown();
      } catch {
        await reportOwnedError(runId, dependencies);
      } finally {
        dependencies.session.finish(runId);
        if (dependencies.session.activeRunId === null) dependencies.clearActivity();
      }
    }
  }
}

async function reportOwnedError(
  runId: string,
  dependencies: ScopedContentLoopDependencies,
): Promise<void> {
  if (!dependencies.session.isActive(runId)) return;
  try {
    await dependencies.endRun(runId, 'error');
  } catch {
    // The run is still locally contained even if the worker disappeared mid-report.
    dependencies.session.finish(runId);
  }
}

function ownedByAnotherRun(runId: string, session: ContentRunSession): boolean {
  return session.activeRunId !== null && session.activeRunId !== runId;
}
