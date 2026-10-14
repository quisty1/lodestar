import type {
  AutopilotState,
  EffectDescriptor,
  EffectLease,
  EffectLedgerV1,
  EffectOutcome,
  EffectReceipt,
} from '../types';
import { nonEmptyString } from './runStateProjection';

export function withoutRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [entryKey, value] of Object.entries(record)) {
    if (entryKey !== key) next[entryKey] = value;
  }
  return next;
}

export function findEffect(
  ledger: EffectLedgerV1,
  predicate: (effect: EffectLease | EffectReceipt) => boolean,
): { kind: 'lease'; value: EffectLease } | { kind: 'receipt'; value: EffectReceipt } | null {
  const lease = Object.values(ledger.active).find(predicate);
  if (lease) return { kind: 'lease', value: lease };
  const receipt = Object.values(ledger.receipts).find(predicate);
  return receipt ? { kind: 'receipt', value: receipt } : null;
}

export function receiptFromLease(
  lease: EffectLease,
  outcome: EffectOutcome,
  settledAt: string,
  reason: string | undefined,
  accounting: 'pending' | 'applied',
): EffectReceipt {
  const safeReason = nonEmptyString(reason);
  return {
    effectId: lease.effectId,
    requestId: lease.requestId,
    descriptor: lease.descriptor,
    reservedAt: lease.reservedAt,
    ...(lease.committedAt ? { committedAt: lease.committedAt } : {}),
    ...(lease.commitAttemptId ? { commitAttemptId: lease.commitAttemptId } : {}),
    outcome,
    ...(safeReason ? { reason: safeReason } : {}),
    settledAt: latestTimestamp(settledAt, lease.committedAt ?? lease.reservedAt),
    accounting,
  };
}

export function latestTimestamp(...timestamps: string[]): string {
  return timestamps.reduce((latest, candidate) => (candidate > latest ? candidate : latest));
}

export function sameEffectDescriptor(left: EffectDescriptor, right: EffectDescriptor): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function cancelReservedEffects(
  ledger: EffectLedgerV1,
  settledAt: string,
  reason: string,
): EffectLedgerV1 {
  let active = { ...ledger.active };
  const receipts = { ...ledger.receipts };
  for (const lease of Object.values(ledger.active)) {
    if (lease.stage !== 'reserved') continue;
    active = withoutRecordKey(active, lease.effectId);
    receipts[lease.effectId] = receiptFromLease(lease, 'cancelled', settledAt, reason, 'applied');
  }
  return { version: 1, active, receipts };
}

export function hasBlockingEffects(ledger: EffectLedgerV1): boolean {
  return (
    Object.values(ledger.active).some((lease) => lease.stage === 'committed') ||
    Object.values(ledger.receipts).some((receipt) => receipt.accounting === 'pending')
  );
}

export function spendLikeSafety(state: AutopilotState, at: number): AutopilotState {
  return {
    ...state,
    used: finiteUsed(state.used) + 1,
    actionTimestamps: [
      ...(Array.isArray(state.actionTimestamps) ? state.actionTimestamps : []),
      at,
    ].slice(-20),
  };
}

function finiteUsed(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
