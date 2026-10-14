import { describe, expect, it, vi } from 'vitest';
import type {
  CommitEffectResult,
  ReserveEffectResult,
  SettleEffectResult,
} from '@lib/autopilot/RunCoordinator';
import type { LodestarMessage, EffectDescriptor } from '@lib/types';
import { EffectRuntimeClient } from './EffectRuntimeClient';

const descriptor: EffectDescriptor = { kind: 'like', targetKey: 'urn:li:activity:1' };

function responseFor(
  message: LodestarMessage,
): ReserveEffectResult | CommitEffectResult | SettleEffectResult {
  switch (message.type) {
    case 'AUTOPILOT_RESERVE_EFFECT':
      return {
        kind: 'reserved',
        canExecute: true,
        effectId: 'effect-1',
        lease: {
          effectId: 'effect-1',
          requestId: message.requestId,
          descriptor: message.descriptor,
          stage: 'reserved',
          reservedAt: '2026-08-11T10:00:00.000Z',
        },
      };
    case 'AUTOPILOT_COMMIT_EFFECT':
      return {
        kind: 'committed',
        admitted: true,
        lease: {
          effectId: message.effectId,
          requestId: message.requestId,
          descriptor,
          stage: 'committed',
          reservedAt: '2026-08-11T10:00:00.000Z',
          committedAt: '2026-08-11T10:00:01.000Z',
          commitAttemptId: message.attemptId,
        },
      };
    case 'AUTOPILOT_SETTLE_EFFECT':
      return {
        kind: 'settled',
        receipt: {
          effectId: message.effectId,
          requestId: message.requestId,
          descriptor,
          reservedAt: '2026-08-11T10:00:00.000Z',
          committedAt: '2026-08-11T10:00:01.000Z',
          commitAttemptId: message.attemptId,
          outcome: message.outcome,
          settledAt: '2026-08-11T10:00:02.000Z',
          accounting: 'applied',
        },
      };
    default:
      throw new Error(`unexpected:${message.type}`);
  }
}

describe('EffectRuntimeClient', () => {
  it('retries lost reserve, commit and settle responses with stable identities', async () => {
    const attempts = new Map<string, number>();
    const messages: LodestarMessage[] = [];
    const send = vi.fn(async (message: LodestarMessage) => {
      messages.push(message);
      const seen = (attempts.get(message.type) ?? 0) + 1;
      attempts.set(message.type, seen);
      if (seen === 1) throw new Error('response channel closed');
      return responseFor(message);
    });
    const ids = ['request-1', 'attempt-1'];
    const client = new EffectRuntimeClient({ send, createId: () => ids.shift()! });

    const result = await client.execute('run-1', descriptor, async ({ commit }) => {
      expect(await commit()).toBe(true);
      return { outcome: 'confirmed' };
    });

    expect(result).toMatchObject({ outcome: 'confirmed', effectId: 'effect-1' });
    expect(attempts).toEqual(
      new Map([
        ['AUTOPILOT_RESERVE_EFFECT', 2],
        ['AUTOPILOT_COMMIT_EFFECT', 2],
        ['AUTOPILOT_SETTLE_EFFECT', 2],
      ]),
    );
    const commits = messages.filter((m) => m.type === 'AUTOPILOT_COMMIT_EFFECT');
    const settles = messages.filter((m) => m.type === 'AUTOPILOT_SETTLE_EFFECT');
    expect(commits).toHaveLength(2);
    expect(
      new Set(commits.map((m) => m.type === 'AUTOPILOT_COMMIT_EFFECT' && m.attemptId)),
    ).toEqual(new Set(['attempt-1']));
    expect(
      new Set(settles.map((m) => m.type === 'AUTOPILOT_SETTLE_EFFECT' && m.attemptId)),
    ).toEqual(new Set(['attempt-1']));
  });

  it('runs only one executor for concurrent retries of the same request', async () => {
    const execute = vi.fn(async ({ commit }: { commit(): Promise<boolean> }) => {
      await commit();
      return { outcome: 'confirmed' as const };
    });
    const client = new EffectRuntimeClient({
      send: async (message) => responseFor(message),
      createId: vi.fn().mockReturnValueOnce('attempt-1'),
    });

    const [first, retry] = await Promise.all([
      client.execute('run-1', descriptor, execute, 'request-1'),
      client.execute('run-1', descriptor, execute, 'request-1'),
    ]);

    expect(first).toEqual(retry);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('does not call the executor when another request owns the target', async () => {
    const execute = vi.fn();
    const client = new EffectRuntimeClient({
      send: async (message) =>
        message.type === 'AUTOPILOT_RESERVE_EFFECT'
          ? { kind: 'duplicate-target', canExecute: false, effectId: 'other-effect' }
          : responseFor(message),
      createId: () => 'request-1',
    });

    const result = await client.execute('run-1', descriptor, execute);

    expect(result).toMatchObject({ outcome: 'already', reason: 'duplicate-target' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('replays a committed duplicate-request receipt without re-running the executor', async () => {
    const execute = vi.fn();
    const client = new EffectRuntimeClient({
      send: async (message) =>
        message.type === 'AUTOPILOT_RESERVE_EFFECT'
          ? {
              kind: 'duplicate-request',
              canExecute: false,
              effectId: 'effect-1',
              receipt: {
                effectId: 'effect-1',
                requestId: 'request-1',
                descriptor,
                reservedAt: '2026-08-11T10:00:00.000Z',
                committedAt: '2026-08-11T10:00:01.000Z',
                commitAttemptId: 'old-attempt',
                outcome: 'confirmed',
                settledAt: '2026-08-11T10:00:02.000Z',
                accounting: 'applied',
              },
            }
          : responseFor(message),
      createId: () => 'request-1',
    });

    await expect(client.execute('run-1', descriptor, execute)).resolves.toMatchObject({
      outcome: 'confirmed',
      committed: false,
      settled: true,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'inactive', canExecute: false }, 'cancelled'],
    [{ kind: 'ledger-error', canExecute: false, error: 'unsupported-version' }, 'failed'],
  ] as const)('fails closed for a non-duplicate reserve result', async (reserve, outcome) => {
    const client = new EffectRuntimeClient({
      send: async (message) =>
        message.type === 'AUTOPILOT_RESERVE_EFFECT' ? reserve : responseFor(message),
      createId: () => 'request-1',
    });

    await expect(client.execute('run-1', descriptor, vi.fn())).resolves.toMatchObject({
      outcome,
      reason: reserve.kind,
    });
  });

  it.each([
    { kind: 'garbage', admitted: true },
    {
      kind: 'committed',
      admitted: true,
      lease: {
        effectId: 'other-effect',
        requestId: 'request-1',
        descriptor,
        stage: 'committed',
        reservedAt: '2026-08-11T10:00:00.000Z',
        committedAt: '2026-08-11T10:00:01.000Z',
        commitAttemptId: 'attempt-1',
      },
    },
    {
      kind: 'committed',
      admitted: true,
      lease: {
        effectId: 'effect-1',
        requestId: 'request-1',
        descriptor,
        stage: 'committed',
        reservedAt: '2026-08-11T10:00:00.000Z',
        committedAt: '2026-08-11T10:00:01.000Z',
        commitAttemptId: 'other-attempt',
      },
    },
  ])(
    'never crosses the irreversible edge for a malformed admitted commit %#',
    async (commitResponse) => {
      const click = vi.fn();
      const ids = ['request-1', 'attempt-1'];
      const client = new EffectRuntimeClient({
        send: async (message) =>
          message.type === 'AUTOPILOT_COMMIT_EFFECT' ? commitResponse : responseFor(message),
        createId: () => ids.shift()!,
      });

      const result = await client.execute('run-1', descriptor, async ({ commit }) => {
        if (await commit()) click();
        return { outcome: 'failed', reason: 'commit_rejected' };
      });

      expect(click).not.toHaveBeenCalled();
      expect(result).toMatchObject({ outcome: 'failed', reason: 'commit_rejected' });
    },
  );

  it('clicks once but marks a committed effect unsettled when every settle response is lost', async () => {
    const click = vi.fn();
    const ids = ['request-1', 'attempt-1'];
    const send = vi.fn(async (message: LodestarMessage) => {
      if (message.type === 'AUTOPILOT_SETTLE_EFFECT') throw new Error('response channel closed');
      return responseFor(message);
    });
    const client = new EffectRuntimeClient({ send, createId: () => ids.shift()! });

    const result = await client.execute('run-1', descriptor, async ({ commit }) => {
      if (await commit()) click();
      return { outcome: 'confirmed' };
    });

    expect(click).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      outcome: 'confirmed',
      committed: true,
      settled: false,
    });
    expect(
      send.mock.calls.filter(([message]) => message.type === 'AUTOPILOT_SETTLE_EFFECT'),
    ).toHaveLength(3);
  });

  it('requires recovery when commit persisted but every commit response was lost', async () => {
    const click = vi.fn();
    let commitPersisted = false;
    const ids = ['request-1', 'attempt-1'];
    const send = vi.fn(async (message: LodestarMessage) => {
      if (message.type === 'AUTOPILOT_COMMIT_EFFECT') {
        commitPersisted = true;
        throw new Error('response channel closed');
      }
      if (message.type === 'AUTOPILOT_SETTLE_EFFECT') {
        return { kind: 'rejected', reason: 'attempt' };
      }
      return responseFor(message);
    });
    const client = new EffectRuntimeClient({ send, createId: () => ids.shift()! });

    const result = await client.execute('run-1', descriptor, async ({ commit }) => {
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
