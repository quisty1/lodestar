import { isScopedAutopilotState } from '@lib/autopilot/RunCoordinator';
import type { AutopilotState, RunReport } from '@lib/types';

export async function recoverPersistedEffects(dependencies: {
  getState(): Promise<AutopilotState | null>;
  finish(runId: string, state: AutopilotState): Promise<void>;
  recover(): Promise<RunReport | null>;
  broadcast(report: RunReport): void;
}): Promise<RunReport | null> {
  const state = await dependencies.getState();
  if (isScopedAutopilotState(state)) {
    if (state.phase === 'stopping' || state.phase === 'finalizing') {
      await dependencies.finish(state.runId, state);
      return null;
    }
    if (state.phase === 'finished') return null;
  }

  const report = await dependencies.recover();
  if (report) dependencies.broadcast(report);
  return report;
}
