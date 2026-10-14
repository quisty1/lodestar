import { RUN_PHASES } from '../types';
import type { AutopilotState, AutopilotStatus, RunPhase, RunReport } from '../types';
import type { RiskMarker } from './RiskAssessor';
import { classifyEffectLedger, EffectLedgerStateError } from './EffectLedger';
import {
  buildReportModules,
  withEffectLedgerOutcomes,
  withEngagementRunDelta,
} from './runOutcomes';

const RUN_PHASE_SET = new Set<RunPhase>(RUN_PHASES);

const TERMINAL_PHASES = new Set<RunPhase>(['stopping', 'finalizing', 'finished']);

export type ScopedAutopilotState = AutopilotState & {
  runId: string;
  startRequestId: string;
  phase: RunPhase;
  startedUsed: number;
  riskMarkers: RiskMarker[];
  updatedAt: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRunPhase(value: unknown): value is RunPhase {
  return typeof value === 'string' && RUN_PHASE_SET.has(value as RunPhase);
}

export function isScopedAutopilotState(
  state: AutopilotState | null,
): state is ScopedAutopilotState {
  return (
    isObject(state) &&
    typeof state.runId === 'string' &&
    typeof state.startRequestId === 'string' &&
    isRunPhase(state.phase) &&
    typeof state.startedUsed === 'number' &&
    Number.isFinite(state.startedUsed) &&
    Array.isArray(state.riskMarkers) &&
    typeof state.updatedAt === 'string'
  );
}

export function isMutableActiveState(state: AutopilotState | null): state is ScopedAutopilotState {
  return isScopedAutopilotState(state) && state.running && !TERMINAL_PHASES.has(state.phase);
}

export function isActiveRun(state: AutopilotState | null, runId?: string): boolean {
  return (
    isMutableActiveState(state) &&
    classifyEffectLedger(state.effectLedger).kind !== 'invalid' &&
    (runId === undefined || state.runId === runId)
  );
}

export function needsRecovery(state: AutopilotState): boolean {
  if (!isScopedAutopilotState(state)) return state.running;
  return state.phase === 'stopping' || state.phase === 'finalizing' || state.running;
}

export function statusFromState(state: AutopilotState | null): AutopilotStatus {
  if (!state) return { running: false, used: 0, ceiling: 0, revision: 0 };
  if (!isScopedAutopilotState(state)) {
    return {
      running: false,
      used: finiteOrZero(state.used),
      ceiling: finiteOrZero(state.ceiling),
      revision: revisionOf(state.revision),
      recoveryRequired: state.running,
    };
  }
  const ledgerBlocked = classifyEffectLedger(state.effectLedger).kind === 'invalid';
  return {
    running: isMutableActiveState(state) && !ledgerBlocked,
    used: finiteOrZero(state.used),
    ceiling: finiteOrZero(state.ceiling),
    revision: revisionOf(state.revision),
    runId: state.runId,
    phase: state.phase,
    stage: state.stage,
    expectedUrl: state.expectedUrl,
    stopReason: state.stopReason,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    recoveryRequired: ledgerBlocked || state.phase === 'stopping' || state.phase === 'finalizing',
  };
}

export function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function revisionOf(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function reportFromState(
  state: AutopilotState & { runId: string; startedUsed: number },
): RunReport {
  const classified = classifyEffectLedger(state.effectLedger);
  if (classified.kind === 'invalid') throw new EffectLedgerStateError(classified.error);
  const outcomes =
    classified.kind === 'valid'
      ? withEffectLedgerOutcomes(
          state.moduleOutcomes ?? {},
          Object.values(classified.ledger.receipts),
        )
      : withEngagementRunDelta(state.moduleOutcomes ?? {}, state.used, state.startedUsed);
  return {
    id: state.runId,
    startedAt: state.startedAt,
    endedAt: state.endedAt ?? state.updatedAt ?? state.startedAt,
    host: state.host,
    stopReason: state.stopReason ?? 'error',
    modules: buildReportModules(outcomes),
  };
}

export function terminalPhase(phase: RunPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}
