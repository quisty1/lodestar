import { describe, expect, it, vi } from 'vitest';
import type { EffectDescriptor } from '@lib/types';
import { WorkerEffectClient } from './WorkerEffectClient';

const descriptor: EffectDescriptor = {
  kind: 'profile_view',
  targetKey: 'member-1',
  person: {
    memberId: 'member-1',
    name: 'One',
    headline: 'Engineer',
    profileUrl: 'https://www.linkedin.com/in/one/',
  },
};

describe('WorkerEffectClient', () => {
  it('reserves, commits at the supplied edge and settles with stable identities', async () => {
    const reserveEffect = vi.fn(async () => ({
      kind: 'reserved' as const,
      canExecute: true as const,
      effectId: 'effect-1',
      lease: {
        effectId: 'effect-1',
        requestId: 'request-1',
        descriptor,
        stage: 'reserved' as const,
        reservedAt: '2026-08-11T10:00:00.000Z',
      },
    }));
    const commitEffect = vi.fn(async () => ({
      kind: 'committed' as const,
      admitted: true as const,
      lease: {
        effectId: 'effect-1',
        requestId: 'request-1',
        descriptor,
        stage: 'committed' as const,
        reservedAt: '2026-08-11T10:00:00.000Z',
        committedAt: '2026-08-11T10:00:01.000Z',
        commitAttemptId: 'attempt-1',
      },
    }));
    const settle = vi.fn(async () => ({ kind: 'settled' as const, receipt: {} as never }));
    const client = new WorkerEffectClient({
      coordinator: { reserveEffect, commitEffect },
      effects: { settle },
      createId: () => 'attempt-1',
    });

    const result = await client.execute('run-1', 'request-1', descriptor, async ({ commit }) => {
      expect(await commit()).toBe(true);
      return { outcome: 'confirmed' };
    });

    expect(result.outcome).toBe('confirmed');
    expect(commitEffect).toHaveBeenCalledWith('run-1', 'effect-1', 'request-1', 'attempt-1');
    expect(settle).toHaveBeenCalledWith('run-1', 'effect-1', 'request-1', 'confirmed', {
      attemptId: 'attempt-1',
      reason: undefined,
    });
  });

  it('returns a token for a content executor without committing it in the worker', async () => {
    const commitEffect = vi.fn();
    const client = new WorkerEffectClient({
      coordinator: {
        reserveEffect: vi.fn(async () => ({
          kind: 'reserved' as const,
          canExecute: true as const,
          effectId: 'effect-1',
          lease: {
            effectId: 'effect-1',
            requestId: 'request-1',
            descriptor,
            stage: 'reserved' as const,
            reservedAt: '2026-08-11T10:00:00.000Z',
          },
        })),
        commitEffect,
      },
      effects: { settle: vi.fn() },
      createId: () => 'attempt-1',
    });

    expect(await client.reserve('run-1', 'request-1', descriptor)).toMatchObject({
      kind: 'ready',
      token: { runId: 'run-1', requestId: 'request-1', effectId: 'effect-1', descriptor },
    });
    expect(commitEffect).not.toHaveBeenCalled();
  });

  it('fails closed instead of mapping inactive or ledger errors to already', async () => {
    const client = new WorkerEffectClient({
      coordinator: {
        reserveEffect: vi.fn(async () => ({
          kind: 'ledger-error' as const,
          canExecute: false as const,
          error: 'unsupported-version' as const,
        })),
        commitEffect: vi.fn(),
      },
      effects: { settle: vi.fn() },
      createId: () => 'attempt-1',
    });

    expect(await client.reserve('run-1', 'request-1', descriptor)).toEqual({
      kind: 'blocked',
      outcome: 'failed',
      reason: 'ledger-error',
    });
  });

  it('exposes a rejected settlement so the worker stops before another effect', async () => {
    const client = new WorkerEffectClient({
      coordinator: {
        reserveEffect: vi.fn(async () => ({
          kind: 'reserved' as const,
          canExecute: true as const,
          effectId: 'effect-1',
          lease: {
            effectId: 'effect-1',
            requestId: 'request-1',
            descriptor,
            stage: 'reserved' as const,
            reservedAt: '2026-08-11T10:00:00.000Z',
          },
        })),
        commitEffect: vi.fn(async () => ({
          kind: 'committed' as const,
          admitted: true as const,
          lease: {
            effectId: 'effect-1',
            requestId: 'request-1',
            descriptor,
            stage: 'committed' as const,
            reservedAt: '2026-08-11T10:00:00.000Z',
            committedAt: '2026-08-11T10:00:01.000Z',
            commitAttemptId: 'attempt-1',
          },
        })),
      },
      effects: {
        settle: vi.fn(async () => ({ kind: 'rejected' as const, reason: 'attempt' as const })),
      },
      createId: () => 'attempt-1',
    });

    const result = await client.execute('run-1', 'request-1', descriptor, async ({ commit }) => {
      await commit();
      return { outcome: 'confirmed' };
    });

    expect(result).toMatchObject({ outcome: 'confirmed', committed: true, settled: false });
  });

  it('requires recovery when a persisted worker commit loses its response', async () => {
    let commitPersisted = false;
    const click = vi.fn();
    const client = new WorkerEffectClient({
      coordinator: {
        reserveEffect: vi.fn(async () => ({
          kind: 'reserved' as const,
          canExecute: true as const,
          effectId: 'effect-1',
          lease: {
            effectId: 'effect-1',
            requestId: 'request-1',
            descriptor,
            stage: 'reserved' as const,
            reservedAt: '2026-08-11T10:00:00.000Z',
          },
        })),
        commitEffect: vi.fn(async () => {
          commitPersisted = true;
          throw new Error('response channel closed');
        }),
      },
      effects: {
        settle: vi.fn(async () => ({ kind: 'rejected' as const, reason: 'attempt' as const })),
      },
      createId: () => 'attempt-1',
    });

    const result = await client.execute('run-1', 'request-1', descriptor, async ({ commit }) => {
      if (await commit()) click();
      return { outcome: 'failed', reason: 'commit_rejected' };
    });

    expect(commitPersisted).toBe(true);
    expect(click).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: 'failed',
      reserved: true,
      committed: false,
      settled: false,
    });
  });
});
