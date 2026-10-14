import { describe, expect, it } from 'vitest';
import { classifyEffectLedger } from './EffectLedger';

const descriptor = {
  kind: 'like',
  targetKey: 'urn:li:activity:1',
  postUrn: 'urn:li:activity:1',
};

describe('classifyEffectLedger', () => {
  it('distinguishes a missing legacy ledger from unsupported and malformed persisted data', () => {
    const future = { version: 2, active: { opaque: true }, receipts: {} };
    const malformed = {
      version: 1,
      active: {
        broken: {
          effectId: 'broken',
          requestId: 'request-1',
          descriptor: { kind: 'publish', targetKey: 'draft' },
          stage: 'reserved',
          reservedAt: '2026-08-11T10:00:00.000Z',
        },
      },
      receipts: {},
    };

    expect(classifyEffectLedger(undefined)).toEqual({ kind: 'missing' });
    const unsupported = classifyEffectLedger(future);
    expect(unsupported).toMatchObject({
      kind: 'invalid',
      error: 'unsupported-version',
    });
    if (unsupported.kind !== 'invalid') throw new Error('expected unsupported ledger');
    expect(unsupported.source).toBe(future);
    const invalid = classifyEffectLedger(malformed);
    expect(invalid).toMatchObject({ kind: 'invalid', error: 'malformed-v1' });
    if (invalid.kind !== 'invalid') throw new Error('expected malformed ledger');
    expect(invalid.source).toBe(malformed);
  });

  it('drops historical withdraw entries and keeps the rest of a v1 ledger valid', () => {
    const classified = classifyEffectLedger({
      version: 1,
      active: {
        'withdraw-lease': {
          effectId: 'withdraw-lease',
          requestId: 'withdraw-request',
          descriptor: { kind: 'withdraw', targetKey: 'invite-1' },
          stage: 'reserved',
          reservedAt: '2026-08-11T10:00:00.000Z',
        },
      },
      receipts: {
        'withdraw-receipt': {
          effectId: 'withdraw-receipt',
          requestId: 'withdraw-receipt-request',
          descriptor: {
            kind: 'withdraw',
            targetKey: 'invite-2',
            memberId: 'member-2',
          },
          reservedAt: '2026-08-11T10:00:00.000Z',
          outcome: 'confirmed',
          accounting: 'applied',
        },
        'effect-1': {
          effectId: 'effect-1',
          requestId: 'request-1',
          descriptor,
          reservedAt: '2026-08-11T10:00:00.000Z',
          outcome: 'cancelled',
          accounting: 'applied',
        },
      },
    });

    expect(classified.kind).toBe('valid');
    if (classified.kind !== 'valid') throw new Error('expected valid ledger');
    expect(classified.ledger.active).toEqual({});
    expect(Object.keys(classified.ledger.receipts)).toEqual(['effect-1']);
  });

  it('canonicalizes valid ISO timestamps and migrates an otherwise valid legacy receipt', () => {
    const classified = classifyEffectLedger({
      version: 1,
      active: {},
      receipts: {
        'effect-1': {
          effectId: 'effect-1',
          requestId: 'request-1',
          descriptor,
          reservedAt: '2026-08-11T12:00:00+02:00',
          committedAt: '2026-08-11T12:00:01+02:00',
          outcome: 'confirmed',
          accounting: 'pending',
        },
      },
    });

    expect(classified.kind).toBe('valid');
    if (classified.kind !== 'valid') throw new Error('expected valid ledger');
    expect(classified.ledger.receipts['effect-1']).toMatchObject({
      reservedAt: '2026-08-11T10:00:00.000Z',
      committedAt: '2026-08-11T10:00:01.000Z',
      settledAt: '2026-08-11T10:00:01.000Z',
      commitAttemptId: 'legacy:effect-1',
    });
  });

  it.each(['not-an-iso-date', '2026-02-31T10:00:00.000Z', '2026-01-01T24:00:00.000Z'])(
    'quarantines invalid timestamp %s instead of canonicalizing it',
    (reservedAt) => {
      const raw = {
        version: 1,
        active: {
          'effect-1': {
            effectId: 'effect-1',
            requestId: 'request-1',
            descriptor,
            stage: 'reserved',
            reservedAt,
          },
        },
        receipts: {},
      };

      const classified = classifyEffectLedger(raw);

      expect(classified).toMatchObject({
        kind: 'invalid',
        error: 'malformed-v1',
      });
      if (classified.kind !== 'invalid') throw new Error('expected malformed ledger');
      expect(classified.source).toBe(raw);
    },
  );

  it.each(['active', 'receipts'] as const)(
    'rejects a prototype-polluting effect id in %s',
    (location) => {
      const lease = {
        effectId: '__proto__',
        requestId: 'request-1',
        descriptor,
        stage: 'reserved',
        reservedAt: '2026-08-11T10:00:00.000Z',
      };
      const receipt = {
        effectId: '__proto__',
        requestId: 'request-1',
        descriptor,
        reservedAt: '2026-08-11T10:00:00.000Z',
        settledAt: '2026-08-11T10:00:00.000Z',
        outcome: 'cancelled',
        accounting: 'applied',
      };
      const raw = JSON.parse(
        JSON.stringify({
          version: 1,
          active: location === 'active' ? { ['__proto__']: lease } : {},
          receipts: location === 'receipts' ? { ['__proto__']: receipt } : {},
        }),
      );

      expect(classifyEffectLedger(raw)).toMatchObject({
        kind: 'invalid',
        error: 'malformed-v1',
      });
    },
  );

  it('quarantines a receipt settled before its committed timestamp', () => {
    const classified = classifyEffectLedger({
      version: 1,
      active: {},
      receipts: {
        'effect-1': {
          effectId: 'effect-1',
          requestId: 'request-1',
          descriptor,
          reservedAt: '2026-08-11T10:00:00.000Z',
          committedAt: '2026-08-11T10:00:02.000Z',
          commitAttemptId: 'attempt-1',
          settledAt: '2026-08-11T10:00:01.000Z',
          outcome: 'confirmed',
          accounting: 'pending',
        },
      },
    });

    expect(classified).toMatchObject({
      kind: 'invalid',
      error: 'malformed-v1',
    });
  });

  it.each([
    [
      'explicit invalid settledAt',
      {
        version: 1,
        active: {},
        receipts: {
          'effect-1': {
            effectId: 'effect-1',
            requestId: 'request-1',
            descriptor,
            reservedAt: '2026-08-11T10:00:00.000Z',
            committedAt: '2026-08-11T10:00:01.000Z',
            commitAttemptId: 'attempt-1',
            settledAt: 'garbage',
            outcome: 'confirmed',
            accounting: 'pending',
          },
        },
      },
    ],
    [
      'explicit invalid committed lease attempt',
      {
        version: 1,
        active: {
          'effect-1': {
            effectId: 'effect-1',
            requestId: 'request-1',
            descriptor,
            reservedAt: '2026-08-11T10:00:00.000Z',
            committedAt: '2026-08-11T10:00:01.000Z',
            commitAttemptId: '   ',
            stage: 'committed',
          },
        },
        receipts: {},
      },
    ],
    [
      'explicit invalid receipt attempt',
      {
        version: 1,
        active: {},
        receipts: {
          'effect-1': {
            effectId: 'effect-1',
            requestId: 'request-1',
            descriptor,
            reservedAt: '2026-08-11T10:00:00.000Z',
            committedAt: '2026-08-11T10:00:01.000Z',
            commitAttemptId: '',
            outcome: 'confirmed',
            accounting: 'pending',
          },
        },
      },
    ],
  ])('quarantines %s instead of treating it as a missing legacy field', (_label, raw) => {
    expect(classifyEffectLedger(raw)).toMatchObject({
      kind: 'invalid',
      error: 'malformed-v1',
    });
  });
});
