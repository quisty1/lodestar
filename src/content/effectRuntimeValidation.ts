import {
  isEffectOutcome,
  sanitizeEffectDescriptor,
  sanitizeEffectId,
} from '@lib/autopilot/EffectLedger';
import type {
  CommitEffectResult,
  ReserveEffectResult,
  SettleEffectResult,
} from '@lib/autopilot/RunCoordinator';
import type { EffectDescriptor, EffectExecutionToken } from '@lib/types';

export function isReserveResult(
  value: unknown,
  requestId: string,
  descriptor: EffectDescriptor,
): value is ReserveEffectResult {
  if (!isRecord(value)) return false;
  if (value.kind === 'reserved' || value.kind === 'resumed') {
    return (
      value.canExecute === true &&
      validEffectId(value.effectId) &&
      validLease(value.lease, value.effectId, requestId, descriptor, 'reserved')
    );
  }
  if (
    value.kind === 'duplicate-request' ||
    value.kind === 'duplicate-target' ||
    value.kind === 'identity'
  ) {
    if (value.canExecute !== false || !validEffectId(value.effectId)) return false;
    const expectedRequest = value.kind === 'duplicate-request' ? requestId : undefined;
    const expectedDescriptor = value.kind === 'identity' ? undefined : descriptor;
    if (
      value.lease !== undefined &&
      !validLease(value.lease, value.effectId, expectedRequest, expectedDescriptor)
    )
      return false;
    if (
      value.receipt !== undefined &&
      !validReceipt(value.receipt, value.effectId, expectedRequest, expectedDescriptor)
    )
      return false;
    return true;
  }
  if (value.kind === 'ledger-error') {
    return value.canExecute === false && isLedgerError(value.error);
  }
  return (value.kind === 'inactive' || value.kind === 'invalid') && value.canExecute === false;
}

export function isCommitResult(
  value: unknown,
  token: EffectExecutionToken,
  attemptId: string,
): value is CommitEffectResult {
  if (!isRecord(value)) return false;
  if (value.kind === 'committed' || value.kind === 'already-committed') {
    return (
      value.admitted === true &&
      validLease(
        value.lease,
        token.effectId,
        token.requestId,
        token.descriptor,
        'committed',
        attemptId,
      )
    );
  }
  return (
    value.kind === 'rejected' &&
    value.admitted === false &&
    ['inactive', 'not-found', 'identity', 'attempt', 'settled', 'ledger-error'].includes(
      String(value.reason),
    ) &&
    (value.error === undefined || isLedgerError(value.error))
  );
}

export function isSettleResult(
  value: unknown,
  token: EffectExecutionToken,
  attemptId?: string,
): value is SettleEffectResult {
  if (!isRecord(value)) return false;
  if (value.kind === 'settled' || value.kind === 'duplicate' || value.kind === 'upgraded') {
    return validReceipt(
      value.receipt,
      token.effectId,
      token.requestId,
      token.descriptor,
      attemptId,
      true,
    );
  }
  return (
    value.kind === 'rejected' &&
    [
      'inactive',
      'invalid',
      'not-found',
      'identity',
      'attempt',
      'not-committed',
      'finished',
      'ledger-error',
    ].includes(String(value.reason)) &&
    (value.error === undefined || isLedgerError(value.error))
  );
}

function validLease(
  value: unknown,
  effectId?: unknown,
  requestId?: string,
  descriptor?: EffectDescriptor,
  stage?: 'reserved' | 'committed',
  attemptId?: string,
): boolean {
  if (!isRecord(value) || !validEffectId(value.effectId) || !nonEmpty(value.requestId))
    return false;
  if (effectId !== undefined && value.effectId !== effectId) return false;
  if (requestId !== undefined && value.requestId !== requestId) return false;
  if (!sameDescriptor(value.descriptor, descriptor)) return false;
  if (
    !validTimestamp(value.reservedAt) ||
    (value.stage !== 'reserved' && value.stage !== 'committed')
  )
    return false;
  if (stage !== undefined && value.stage !== stage) return false;
  if (value.stage === 'reserved') {
    return (
      value.committedAt === undefined &&
      value.commitAttemptId === undefined &&
      attemptId === undefined
    );
  }
  if (!validTimestamp(value.committedAt) || !nonEmpty(value.commitAttemptId)) return false;
  return attemptId === undefined || value.commitAttemptId === attemptId;
}

function validReceipt(
  value: unknown,
  effectId?: unknown,
  requestId?: string,
  descriptor?: EffectDescriptor,
  attemptId?: string,
  verifyAttempt = false,
): boolean {
  if (!isRecord(value) || !validEffectId(value.effectId) || !nonEmpty(value.requestId))
    return false;
  if (effectId !== undefined && value.effectId !== effectId) return false;
  if (requestId !== undefined && value.requestId !== requestId) return false;
  if (!sameDescriptor(value.descriptor, descriptor)) return false;
  if (!validTimestamp(value.reservedAt) || !validTimestamp(value.settledAt)) return false;
  if (
    !isEffectOutcome(value.outcome) ||
    (value.accounting !== 'pending' && value.accounting !== 'applied')
  )
    return false;
  if (value.committedAt !== undefined && !validTimestamp(value.committedAt)) return false;
  if (value.commitAttemptId !== undefined && !nonEmpty(value.commitAttemptId)) return false;
  if ((value.committedAt === undefined) !== (value.commitAttemptId === undefined)) return false;
  if (verifyAttempt && attemptId !== undefined && value.commitAttemptId !== attemptId) return false;
  if (verifyAttempt && attemptId === undefined && value.commitAttemptId !== undefined) return false;
  return (
    (value.outcome !== 'confirmed' && value.outcome !== 'uncertain') ||
    (value.committedAt !== undefined && value.commitAttemptId !== undefined)
  );
}

function sameDescriptor(value: unknown, expected?: EffectDescriptor): boolean {
  const actual = sanitizeEffectDescriptor(value);
  if (!actual) return false;
  if (!expected) return true;
  const safeExpected = sanitizeEffectDescriptor(expected);
  return safeExpected !== null && JSON.stringify(actual) === JSON.stringify(safeExpected);
}

function validEffectId(value: unknown): value is string {
  return typeof value === 'string' && sanitizeEffectId(value) === value;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isLedgerError(value: unknown): boolean {
  return value === 'unsupported-version' || value === 'malformed-v1';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
