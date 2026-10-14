import { describe, expect, it } from 'vitest';
import type { EffectDescriptor, EffectExecutionToken } from '@lib/types';
import { isCommitResult, isReserveResult, isSettleResult } from './effectRuntimeValidation';

const descriptor: EffectDescriptor = {
  kind: 'like',
  targetKey: 'urn:li:activity:1',
  postUrn: 'urn:li:activity:1',
};
const reservedAt = '2026-08-11T10:00:00.000Z';
const committedAt = '2026-08-11T10:01:00.000Z';
const settledAt = '2026-08-11T10:02:00.000Z';
const token: EffectExecutionToken = {
  runId: 'run-1',
  effectId: 'effect-1',
  requestId: 'req-1',
  descriptor,
};

function lease(stage: 'reserved' | 'committed' = 'reserved', attemptId = 'attempt-1') {
  return {
    effectId: 'effect-1',
    requestId: 'req-1',
    descriptor,
    reservedAt,
    stage,
    ...(stage === 'committed' ? { committedAt, commitAttemptId: attemptId } : {}),
  };
}

function receipt(outcome = 'confirmed', attemptId: string | undefined = 'attempt-1') {
  return {
    effectId: 'effect-1',
    requestId: 'req-1',
    descriptor,
    reservedAt,
    settledAt,
    outcome,
    accounting: 'applied',
    ...(attemptId ? { committedAt, commitAttemptId: attemptId } : {}),
  };
}

describe('isReserveResult', () => {
  it('accepts a reserved or resumed lease for this request', () => {
    expect(
      isReserveResult(
        { kind: 'reserved', canExecute: true, effectId: 'effect-1', lease: lease() },
        'req-1',
        descriptor,
      ),
    ).toBe(true);
    expect(
      isReserveResult(
        { kind: 'resumed', canExecute: true, effectId: 'effect-1', lease: lease() },
        'req-1',
        descriptor,
      ),
    ).toBe(true);
  });

  it('rejects a reserved lease for another request or a missing effect id', () => {
    expect(
      isReserveResult(
        {
          kind: 'reserved',
          canExecute: true,
          effectId: 'effect-1',
          lease: { ...lease(), requestId: 'other' },
        },
        'req-1',
        descriptor,
      ),
    ).toBe(false);
    expect(
      isReserveResult(
        { kind: 'reserved', canExecute: true, effectId: '', lease: lease() },
        'req-1',
        descriptor,
      ),
    ).toBe(false);
  });

  it('accepts duplicates and identity only when execution is refused', () => {
    expect(
      isReserveResult(
        { kind: 'duplicate-request', canExecute: false, effectId: 'effect-1', lease: lease() },
        'req-1',
        descriptor,
      ),
    ).toBe(true);
    expect(
      isReserveResult(
        {
          kind: 'duplicate-target',
          canExecute: false,
          effectId: 'effect-1',
          receipt: receipt('already', undefined),
        },
        'req-1',
        descriptor,
      ),
    ).toBe(true);
    expect(
      isReserveResult(
        {
          kind: 'duplicate-target',
          canExecute: false,
          effectId: 'effect-1',
          lease: {
            ...lease(),
            descriptor: { kind: 'comment', targetKey: 'other', postUrn: 'other' },
          },
        },
        'req-1',
        descriptor,
      ),
    ).toBe(false);
    expect(
      isReserveResult(
        { kind: 'identity', canExecute: false, effectId: 'effect-1' },
        'req-1',
        descriptor,
      ),
    ).toBe(true);
    expect(
      isReserveResult(
        { kind: 'duplicate-request', canExecute: true, effectId: 'effect-1' },
        'req-1',
        descriptor,
      ),
    ).toBe(false);
  });

  it('accepts ledger errors and inactive or invalid refusals', () => {
    expect(
      isReserveResult(
        { kind: 'ledger-error', canExecute: false, error: 'unsupported-version' },
        'req-1',
        descriptor,
      ),
    ).toBe(true);
    expect(
      isReserveResult(
        { kind: 'ledger-error', canExecute: false, error: 'malformed-v1' },
        'req-1',
        descriptor,
      ),
    ).toBe(true);
    expect(
      isReserveResult(
        { kind: 'ledger-error', canExecute: false, error: 'other' },
        'req-1',
        descriptor,
      ),
    ).toBe(false);
    expect(isReserveResult({ kind: 'inactive', canExecute: false }, 'req-1', descriptor)).toBe(
      true,
    );
    expect(isReserveResult({ kind: 'invalid', canExecute: true }, 'req-1', descriptor)).toBe(false);
  });
});

describe('isCommitResult', () => {
  it('accepts a committed lease for this attempt and rejects a foreign one', () => {
    expect(
      isCommitResult(
        { kind: 'committed', admitted: true, lease: lease('committed') },
        token,
        'attempt-1',
      ),
    ).toBe(true);
    expect(
      isCommitResult(
        { kind: 'already-committed', admitted: true, lease: lease('committed', 'other') },
        token,
        'attempt-1',
      ),
    ).toBe(false);
  });

  it('accepts a rejected commit with a known reason', () => {
    expect(
      isCommitResult({ kind: 'rejected', admitted: false, reason: 'attempt' }, token, 'attempt-1'),
    ).toBe(true);
    expect(
      isCommitResult({ kind: 'rejected', admitted: false, reason: 'nope' }, token, 'attempt-1'),
    ).toBe(false);
  });
});

describe('isSettleResult', () => {
  it('accepts a receipt for this attempt and rejects a foreign attempt', () => {
    expect(isSettleResult({ kind: 'settled', receipt: receipt() }, token, 'attempt-1')).toBe(true);
    expect(
      isSettleResult(
        { kind: 'duplicate', receipt: receipt('confirmed', 'other') },
        token,
        'attempt-1',
      ),
    ).toBe(false);
    expect(isSettleResult({ kind: 'upgraded', receipt: receipt() }, token, undefined)).toBe(false);
  });

  it('accepts a rejected settle and a failed receipt when no attempt is claimed', () => {
    expect(isSettleResult({ kind: 'rejected', reason: 'not-committed' }, token)).toBe(true);
    expect(isSettleResult({ kind: 'rejected', reason: 'mystery' }, token)).toBe(false);
    expect(
      isSettleResult({ kind: 'settled', receipt: receipt('failed', '') }, token, undefined),
    ).toBe(true);
  });
});
