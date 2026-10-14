import type { AutopilotState, StopReason } from '../types';
import { classifyEffectLedger, emptyEffectLedger } from './EffectLedger';
import { cancelReservedEffects, hasBlockingEffects } from './effectLedgerOps';
import type { BeginRunInput, BeginRunResult } from './runCoordinator.types';
import type { Written } from './effectReserve';
import type { ScopedAutopilotState } from './runStateProjection';
import {
  finiteOrZero,
  isMutableActiveState,
  isScopedAutopilotState,
  needsRecovery,
  nonEmptyString,
} from './runStateProjection';

export function decideBegin(
  existing: AutopilotState | null,
  input: BeginRunInput,
  now: () => string,
  createId: () => string,
): Written<BeginRunResult> {
  if (existing) {
    const ledger = classifyEffectLedger(existing.effectLedger);
    if (ledger.kind === 'invalid') {
      return {
        result: {
          kind: 'recovery-required',
          runId: nonEmptyString(existing.runId) ?? undefined,
          state: existing,
        },
      };
    }
    if (
      ledger.kind === 'valid' &&
      (!isScopedAutopilotState(existing) || hasBlockingEffects(ledger.ledger))
    ) {
      return {
        result: {
          kind: 'recovery-required',
          runId: nonEmptyString(existing.runId) ?? undefined,
          state: existing,
        },
      };
    }
  }
  const requestId = nonEmptyString(input.requestId) ?? input.requestId;
  if (existing && isScopedAutopilotState(existing) && existing.startRequestId === requestId) {
    return { result: { kind: 'duplicate', runId: existing.runId, state: existing } };
  }
  if (existing && isMutableActiveState(existing)) {
    return { result: { kind: 'already-running', runId: existing.runId, state: existing } };
  }
  if (existing && needsRecovery(existing)) {
    return { result: { kind: 'recovery-required', runId: existing.runId, state: existing } };
  }

  const stamped = now();
  const runId = createId();
  const state: AutopilotState = {
    running: true,
    host: input.host,
    windowId: input.windowId,
    tabId: input.tabId,
    day: input.day,
    ceiling: input.ceiling,
    used: input.used,
    actionTimestamps: [],
    actionsSinceBreak: 0,
    manualStop: false,
    startedAt: stamped,
    moduleOutcomes: {},
    runId,
    startRequestId: requestId,
    phase: 'starting',
    startedUsed: input.used,
    riskMarkers: [],
    effectLedger: emptyEffectLedger(),
    updatedAt: stamped,
    expectedUrl: input.expectedUrl,
  };
  return { result: { kind: 'started', runId, state }, next: state };
}

export function decideStop(
  state: AutopilotState | null,
  runId: string,
  reason: StopReason,
  now: () => string,
): Written<AutopilotState | null> {
  if (!isScopedAutopilotState(state) || state.runId !== runId) return { result: null };
  if (state.phase === 'finished' || state.phase === 'stopping' || state.phase === 'finalizing') {
    return { result: state };
  }

  const stamped = now();
  const classified = classifyEffectLedger(state.effectLedger);
  const effectLedger =
    classified.kind === 'valid'
      ? cancelReservedEffects(classified.ledger, stamped, `stop:${reason}`)
      : state.effectLedger;
  const stopped: AutopilotState = {
    ...state,
    running: false,
    manualStop: state.manualStop || reason === 'manual',
    phase: 'stopping',
    stopReason: state.stopReason ?? reason,
    endedAt: state.endedAt ?? stamped,
    updatedAt: stamped,
    ...(effectLedger !== undefined ? { effectLedger } : {}),
  };
  return { result: stopped, next: stopped };
}

export type FinalizeDecision =
  | { kind: 'missing' }
  | { kind: 'existing' }
  | { kind: 'finalize'; state: ScopedAutopilotState; stopReason: StopReason };

export function decideFinalize(
  state: AutopilotState | null,
  runId: string,
  reason: StopReason | undefined,
  now: () => string,
): FinalizeDecision {
  if (!isScopedAutopilotState(state) || state.runId !== runId) return { kind: 'missing' };
  if (state.phase === 'finished') return { kind: 'existing' };

  const stopReason = state.stopReason ?? reason;
  if (!stopReason) return { kind: 'missing' };
  const classified = classifyEffectLedger(state.effectLedger);
  if (classified.kind === 'invalid') return { kind: 'missing' };
  let candidate = state;
  if (classified.kind === 'valid') {
    const effectLedger = cancelReservedEffects(classified.ledger, now(), 'finalize');
    if (hasBlockingEffects(effectLedger)) return { kind: 'missing' };
    candidate = { ...state, effectLedger };
  }
  return { kind: 'finalize', state: candidate, stopReason };
}

export type RecoverDecision =
  | { kind: 'none' }
  | { kind: 'finished'; runId: string; clearRunning?: AutopilotState }
  | { kind: 'finalize'; state: ScopedAutopilotState; stopReason: StopReason };

export function decideRecover(
  state: AutopilotState | null,
  now: () => string,
  createId: () => string,
): RecoverDecision {
  if (!state) return { kind: 'none' };

  const classified = classifyEffectLedger(state.effectLedger);
  if (classified.kind === 'invalid') return { kind: 'none' };
  if (isMutableActiveState(state)) return { kind: 'none' };
  if (!isScopedAutopilotState(state) && classified.kind === 'valid') return { kind: 'none' };

  if (isScopedAutopilotState(state)) {
    if (state.phase === 'finished') {
      return {
        kind: 'finished',
        runId: state.runId,
        ...(state.running ? { clearRunning: { ...state, running: false, updatedAt: now() } } : {}),
      };
    }
    if (state.phase === 'stopping' || state.phase === 'finalizing') {
      let candidate = state;
      if (classified.kind === 'valid') {
        const effectLedger = cancelReservedEffects(classified.ledger, now(), 'recovery');
        if (hasBlockingEffects(effectLedger)) return { kind: 'none' };
        candidate = { ...state, effectLedger };
      }
      return { kind: 'finalize', state: candidate, stopReason: state.stopReason ?? 'interrupted' };
    }
    return { kind: 'none' };
  }

  if (!needsRecovery(state)) return { kind: 'none' };
  const stamped = now();
  const used = finiteOrZero(state.used);
  const runId = nonEmptyString(state.runId) ?? createId();
  const normalized: ScopedAutopilotState = {
    ...state,
    running: false,
    host: state.host === 'window' ? 'window' : 'tab',
    day: nonEmptyString(state.day) ?? stamped.slice(0, 10),
    ceiling: finiteOrZero(state.ceiling),
    used,
    actionTimestamps: Array.isArray(state.actionTimestamps) ? state.actionTimestamps : [],
    actionsSinceBreak: finiteOrZero(state.actionsSinceBreak),
    manualStop: state.manualStop,
    startedAt: nonEmptyString(state.startedAt) ?? stamped,
    moduleOutcomes: isPlainObject(state.moduleOutcomes) ? state.moduleOutcomes : {},
    runId,
    startRequestId: nonEmptyString(state.startRequestId) ?? `recovery:${runId}`,
    phase: 'finalizing',
    startedUsed:
      typeof state.startedUsed === 'number' && Number.isFinite(state.startedUsed)
        ? state.startedUsed
        : used,
    riskMarkers: Array.isArray(state.riskMarkers) ? state.riskMarkers : [],
    updatedAt: stamped,
    stopReason: 'interrupted',
    endedAt: nonEmptyString(state.endedAt) ?? stamped,
  };
  return { kind: 'finalize', state: normalized, stopReason: 'interrupted' };
}

import type { ModuleOutcome } from '../types';

function isPlainObject(value: unknown): value is Record<string, ModuleOutcome> {
  return typeof value === 'object' && value !== null;
}
