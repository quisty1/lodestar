import type { AutopilotState, EffectOutcome, EffectReceipt } from '../types';
import {
  classifyEffectLedger,
  emptyEffectLedger,
  isEffectOutcome,
  sanitizeEffectId,
} from './EffectLedger';
import { receiptFromLease, spendLikeSafety, withoutRecordKey } from './effectLedgerOps';
import type {
  PendingEffects,
  ReconcileEffectsResult,
  SettleEffectOptions,
  SettleEffectResult,
} from './runCoordinator.types';
import type { Written } from './effectReserve';
import { isScopedAutopilotState, nonEmptyString } from './runStateProjection';
import { latestTimestamp } from './effectLedgerOps';

export function transitionSettle(
  state: AutopilotState | null,
  runId: string,
  effectId: string,
  requestId: string,
  outcome: EffectOutcome,
  options: SettleEffectOptions,
  now: () => string,
  nowMs: () => number,
): Written<SettleEffectResult> {
  if (!isScopedAutopilotState(state) || state.runId !== runId)
    return { result: { kind: 'rejected', reason: 'inactive' } };
  if (!isEffectOutcome(outcome)) return { result: { kind: 'rejected', reason: 'invalid' } };
  const safeEffectId = sanitizeEffectId(effectId);
  const safeRequestId = nonEmptyString(requestId);
  if (!safeEffectId || !safeRequestId) return { result: { kind: 'rejected', reason: 'identity' } };
  const classified = classifyEffectLedger(state.effectLedger);
  if (classified.kind === 'invalid') {
    return { result: { kind: 'rejected', reason: 'ledger-error', error: classified.error } };
  }
  const ledger = classified.kind === 'valid' ? classified.ledger : emptyEffectLedger();
  const existing = ledger.receipts[safeEffectId];
  if (existing) {
    if (existing.requestId !== safeRequestId)
      return { result: { kind: 'rejected', reason: 'identity' } };
    if (
      existing.commitAttemptId &&
      existing.commitAttemptId !== nonEmptyString(options.attemptId)
    ) {
      return { result: { kind: 'rejected', reason: 'attempt' } };
    }
    if (existing.outcome === 'uncertain' && outcome === 'confirmed') {
      if (state.phase === 'finished') return { result: { kind: 'rejected', reason: 'finished' } };
      const safeReason = nonEmptyString(options.reason);
      const upgraded: EffectReceipt = {
        ...existing,
        outcome: 'confirmed',
        settledAt: latestTimestamp(now(), existing.settledAt),
        accounting: 'pending',
      };
      if (safeReason) upgraded.reason = safeReason;
      else delete upgraded.reason;
      return {
        result: { kind: 'upgraded', receipt: upgraded },
        next: {
          ...state,
          effectLedger: { ...ledger, receipts: { ...ledger.receipts, [safeEffectId]: upgraded } },
          updatedAt: now(),
        },
      };
    }
    return { result: { kind: 'duplicate', receipt: existing } };
  }
  if (state.phase === 'finished') return { result: { kind: 'rejected', reason: 'finished' } };
  const lease = ledger.active[safeEffectId];
  if (!lease) return { result: { kind: 'rejected', reason: 'not-found' } };
  if (lease.requestId !== safeRequestId)
    return { result: { kind: 'rejected', reason: 'identity' } };
  if (lease.stage === 'committed' && lease.commitAttemptId !== nonEmptyString(options.attemptId)) {
    return { result: { kind: 'rejected', reason: 'attempt' } };
  }
  if ((outcome === 'confirmed' || outcome === 'uncertain') && lease.stage !== 'committed') {
    return { result: { kind: 'rejected', reason: 'not-committed' } };
  }

  const receipt = receiptFromLease(lease, outcome, now(), options.reason, 'pending');
  const active = withoutRecordKey(ledger.active, safeEffectId);
  let next: AutopilotState = {
    ...state,
    effectLedger: { ...ledger, active, receipts: { ...ledger.receipts, [safeEffectId]: receipt } },
    updatedAt: now(),
  };
  if (lease.descriptor.kind === 'like' && (outcome === 'confirmed' || outcome === 'uncertain')) {
    next = spendLikeSafety(next, nowMs());
  }
  return { result: { kind: 'settled', receipt }, next };
}

export function transitionExpire(
  state: AutopilotState | null,
  runId: string,
  committedBefore: string | undefined,
  forceEffectIds: readonly string[],
  now: () => string,
  nowMs: () => number,
): Written<EffectReceipt[]> {
  if (!isScopedAutopilotState(state) || state.runId !== runId || state.phase === 'finished')
    return { result: [] };
  const classified = classifyEffectLedger(state.effectLedger);
  if (classified.kind !== 'valid') return { result: [] };
  const ledger = classified.ledger;
  let active = { ...ledger.active };
  const receipts = { ...ledger.receipts };
  const expired: EffectReceipt[] = [];
  const forced = new Set(
    forceEffectIds.map(sanitizeEffectId).filter((id): id is string => id !== null),
  );
  let next: AutopilotState = state;
  for (const lease of Object.values(ledger.active)) {
    if (lease.stage !== 'committed') continue;
    if (
      !forced.has(lease.effectId) &&
      committedBefore &&
      (lease.committedAt ?? lease.reservedAt) > committedBefore
    ) {
      continue;
    }
    const receipt = receiptFromLease(lease, 'uncertain', now(), 'settlement_timeout', 'pending');
    active = withoutRecordKey(active, lease.effectId);
    receipts[lease.effectId] = receipt;
    expired.push(receipt);
    if (lease.descriptor.kind === 'like') next = spendLikeSafety(next, nowMs());
  }
  if (!expired.length) return { result: [] };
  return {
    result: expired,
    next: { ...next, effectLedger: { ...ledger, active, receipts }, updatedAt: now() },
  };
}

export function transitionReconcile(
  state: AutopilotState | null,
  runId: string,
  options: { expireCommittedBefore?: string },
  now: () => string,
  nowMs: () => number,
): Written<ReconcileEffectsResult> {
  if (!isScopedAutopilotState(state) || state.runId !== runId || state.phase === 'finished') {
    return { result: { cancelled: [], expired: [] } };
  }
  const classified = classifyEffectLedger(state.effectLedger);
  if (classified.kind === 'invalid')
    return { result: { cancelled: [], expired: [], blocked: classified.error } };
  if (classified.kind === 'missing') return { result: { cancelled: [], expired: [] } };
  const ledger = classified.ledger;
  let active = { ...ledger.active };
  const receipts = { ...ledger.receipts };
  const cancelled: EffectReceipt[] = [];
  const expired: EffectReceipt[] = [];
  let next: AutopilotState = state;
  for (const lease of Object.values(ledger.active)) {
    if (lease.stage === 'reserved') {
      const receipt = receiptFromLease(lease, 'cancelled', now(), 'reconciled', 'applied');
      active = withoutRecordKey(active, lease.effectId);
      receipts[lease.effectId] = receipt;
      cancelled.push(receipt);
      continue;
    }
    if (
      options.expireCommittedBefore &&
      (lease.committedAt ?? lease.reservedAt) <= options.expireCommittedBefore
    ) {
      const receipt = receiptFromLease(lease, 'uncertain', now(), 'settlement_timeout', 'pending');
      active = withoutRecordKey(active, lease.effectId);
      receipts[lease.effectId] = receipt;
      expired.push(receipt);
      if (lease.descriptor.kind === 'like') next = spendLikeSafety(next, nowMs());
    }
  }
  if (!cancelled.length && !expired.length) return { result: { cancelled, expired } };
  return {
    result: { cancelled, expired },
    next: { ...next, effectLedger: { ...ledger, active, receipts }, updatedAt: now() },
  };
}

export function pendingFromState(
  state: AutopilotState | null,
  runId: string,
): PendingEffects | null {
  if (!isScopedAutopilotState(state) || state.runId !== runId) return null;
  const classified = classifyEffectLedger(state.effectLedger);
  if (classified.kind === 'invalid')
    return { committed: [], accounting: [], blocked: classified.error };
  const ledger = classified.kind === 'valid' ? classified.ledger : emptyEffectLedger();
  return {
    committed: Object.values(ledger.active).filter((lease) => lease.stage === 'committed'),
    accounting: Object.values(ledger.receipts).filter(
      (receipt) => receipt.accounting === 'pending',
    ),
  };
}
