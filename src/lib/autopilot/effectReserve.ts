import type { AutopilotState, EffectDescriptor, EffectReceipt } from '../types';
import {
  classifyEffectLedger,
  emptyEffectLedger,
  sanitizeEffectDescriptor,
  sanitizeEffectId,
} from './EffectLedger';
import type { CommitEffectResult, ReserveEffectResult } from './runCoordinator.types';
import { findEffect, latestTimestamp, sameEffectDescriptor } from './effectLedgerOps';
import { isMutableActiveState, isScopedAutopilotState, nonEmptyString } from './runStateProjection';

export interface Written<T> {
  result: T;
  next?: AutopilotState;
}

export function transitionReserve(
  state: AutopilotState | null,
  runId: string,
  requestId: string,
  descriptor: EffectDescriptor,
  now: () => string,
  createId: () => string,
): Written<ReserveEffectResult> {
  if (!isMutableActiveState(state) || state.runId !== runId)
    return { result: { kind: 'inactive', canExecute: false } };
  const safeRequestId = nonEmptyString(requestId);
  const safeDescriptor = sanitizeEffectDescriptor(descriptor);
  if (!safeRequestId || !safeDescriptor) return { result: { kind: 'invalid', canExecute: false } };
  const classified = classifyEffectLedger(state.effectLedger);
  if (classified.kind === 'invalid') {
    return { result: { kind: 'ledger-error', canExecute: false, error: classified.error } };
  }
  const ledger = classified.kind === 'valid' ? classified.ledger : emptyEffectLedger();

  const sameRequest = findEffect(ledger, (candidate) => candidate.requestId === safeRequestId);
  if (sameRequest) {
    if (!sameEffectDescriptor(sameRequest.value.descriptor, safeDescriptor)) {
      return sameRequest.kind === 'lease'
        ? {
            result: {
              kind: 'identity',
              canExecute: false,
              effectId: sameRequest.value.effectId,
              lease: sameRequest.value,
            },
          }
        : {
            result: {
              kind: 'identity',
              canExecute: false,
              effectId: sameRequest.value.effectId,
              receipt: sameRequest.value,
            },
          };
    }
    if (sameRequest.kind === 'lease' && sameRequest.value.stage === 'reserved') {
      return {
        result: {
          kind: 'resumed',
          canExecute: true,
          effectId: sameRequest.value.effectId,
          lease: sameRequest.value,
        },
      };
    }
    return sameRequest.kind === 'lease'
      ? {
          result: {
            kind: 'duplicate-request',
            canExecute: false,
            effectId: sameRequest.value.effectId,
            lease: sameRequest.value,
          },
        }
      : {
          result: {
            kind: 'duplicate-request',
            canExecute: false,
            effectId: sameRequest.value.effectId,
            receipt: sameRequest.value,
          },
        };
  }
  const sameTarget = findEffect(
    ledger,
    (candidate) =>
      candidate.descriptor.kind === safeDescriptor.kind &&
      candidate.descriptor.targetKey === safeDescriptor.targetKey,
  );
  if (sameTarget) {
    return sameTarget.kind === 'lease'
      ? {
          result: {
            kind: 'duplicate-target',
            canExecute: false,
            effectId: sameTarget.value.effectId,
            lease: sameTarget.value,
          },
        }
      : {
          result: {
            kind: 'duplicate-target',
            canExecute: false,
            effectId: sameTarget.value.effectId,
            receipt: sameTarget.value,
          },
        };
  }

  const effectId = sanitizeEffectId(createId());
  if (!effectId) return { result: { kind: 'invalid', canExecute: false } };
  const lease = {
    effectId,
    requestId: safeRequestId,
    descriptor: safeDescriptor,
    stage: 'reserved' as const,
    reservedAt: now(),
  };
  return {
    result: { kind: 'reserved', canExecute: true, effectId, lease },
    next: {
      ...state,
      effectLedger: { ...ledger, active: { ...ledger.active, [effectId]: lease } },
      updatedAt: now(),
    },
  };
}

export function transitionCommit(
  state: AutopilotState | null,
  runId: string,
  effectId: string,
  requestId: string,
  attemptId: string,
  now: () => string,
): Written<CommitEffectResult> {
  if (!isScopedAutopilotState(state) || state.runId !== runId) {
    return { result: { kind: 'rejected', admitted: false, reason: 'inactive' } };
  }
  const safeEffectId = sanitizeEffectId(effectId);
  const safeRequestId = nonEmptyString(requestId);
  const safeAttemptId = nonEmptyString(attemptId);
  if (!safeEffectId || !safeRequestId)
    return { result: { kind: 'rejected', admitted: false, reason: 'identity' } };
  if (!safeAttemptId) return { result: { kind: 'rejected', admitted: false, reason: 'attempt' } };
  const classified = classifyEffectLedger(state.effectLedger);
  if (classified.kind === 'invalid') {
    return {
      result: {
        kind: 'rejected',
        admitted: false,
        reason: 'ledger-error',
        error: classified.error,
      },
    };
  }
  const ledger = classified.kind === 'valid' ? classified.ledger : emptyEffectLedger();
  const lease = ledger.active[safeEffectId];
  if (lease) {
    if (lease.requestId !== safeRequestId)
      return { result: { kind: 'rejected', admitted: false, reason: 'identity' } };
    if (lease.stage === 'committed') {
      return lease.commitAttemptId === safeAttemptId
        ? { result: { kind: 'already-committed', admitted: true, lease } }
        : { result: { kind: 'rejected', admitted: false, reason: 'attempt' } };
    }
  }
  if (!isMutableActiveState(state))
    return { result: { kind: 'rejected', admitted: false, reason: 'inactive' } };
  const receipt = ledger.receipts[safeEffectId];
  if (receipt) {
    return receipt.requestId === safeRequestId
      ? { result: { kind: 'rejected', admitted: false, reason: 'settled' } }
      : { result: { kind: 'rejected', admitted: false, reason: 'identity' } };
  }
  if (!lease) return { result: { kind: 'rejected', admitted: false, reason: 'not-found' } };

  const committed = {
    ...lease,
    stage: 'committed' as const,
    committedAt: latestTimestamp(now(), lease.reservedAt),
    commitAttemptId: safeAttemptId,
  };
  return {
    result: { kind: 'committed', admitted: true, lease: committed },
    next: {
      ...state,
      effectLedger: { ...ledger, active: { ...ledger.active, [safeEffectId]: committed } },
      updatedAt: now(),
    },
  };
}

export function transitionMarkAccounted(
  state: AutopilotState | null,
  runId: string,
  effectId: string,
  expected: Pick<EffectReceipt, 'settledAt' | 'outcome'>,
  now: () => string,
): Written<EffectReceipt | null> {
  if (!isScopedAutopilotState(state) || state.runId !== runId) return { result: null };
  const classified = classifyEffectLedger(state.effectLedger);
  if (classified.kind !== 'valid') return { result: null };
  const ledger = classified.ledger;
  const safeEffectId = sanitizeEffectId(effectId);
  if (!safeEffectId) return { result: null };
  const receipt = ledger.receipts[safeEffectId];
  if (!receipt) return { result: null };
  if (receipt.settledAt !== expected.settledAt || receipt.outcome !== expected.outcome)
    return { result: null };
  if (receipt.accounting === 'applied') return { result: receipt };
  const applied = { ...receipt, accounting: 'applied' as const };
  return {
    result: applied,
    next: {
      ...state,
      effectLedger: { ...ledger, receipts: { ...ledger.receipts, [safeEffectId]: applied } },
      updatedAt: now(),
    },
  };
}
