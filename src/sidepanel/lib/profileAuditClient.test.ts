import { describe, expect, it, vi } from 'vitest';
import { WORKER_PROTOCOL_VERSION, runtimeError, runtimeOk } from '@lib/runtimeProtocol';
import { profileAuditFixture } from '@lib/profile/profileAudit.test-fixture';
import { createProfileAuditClient } from './profileAuditClient';

describe('createProfileAuditClient', () => {
  it('wakes the worker and accepts one strictly validated audit result', async () => {
    const result = profileAuditFixture();
    const sendMessage = vi.fn(async (message: unknown) =>
      (message as { type?: string }).type === 'PING'
        ? { type: 'PONG', protocolVersion: WORKER_PROTOCOL_VERSION }
        : runtimeOk({ requestId: 'request-1', result }),
    );
    const client = createProfileAuditClient({ sendMessage, timeoutMs: 25, wakeDelaysMs: [0] });

    await expect(
      client.start({ type: 'START_PROFILE_AUDIT', requestId: 'request-1' }),
    ).resolves.toEqual(runtimeOk({ requestId: 'request-1', result }));
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: 'PING' });
  });

  it('retries transport failure with the exact same idempotent request object', async () => {
    const result = profileAuditFixture();
    const request = { type: 'START_PROFILE_AUDIT', requestId: 'request-1' } as const;
    const seen: unknown[] = [];
    let commandAttempts = 0;
    const sendMessage = vi.fn(async (message: unknown) => {
      if ((message as { type?: string }).type === 'PING')
        return { type: 'PONG', protocolVersion: WORKER_PROTOCOL_VERSION };
      seen.push(message);
      commandAttempts += 1;
      if (commandAttempts === 1) throw new Error('worker restarted');
      return runtimeOk({ requestId: 'request-1', result });
    });
    const client = createProfileAuditClient({ sendMessage, timeoutMs: 25, wakeDelaysMs: [0] });

    await expect(client.start(request)).resolves.toMatchObject({ ok: true });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(request);
    expect(seen[1]).toBe(request);
  });

  it('fails closed on a malformed successful envelope', async () => {
    const sendMessage = vi.fn(async (message: unknown) =>
      (message as { type?: string }).type === 'PING'
        ? { type: 'PONG', protocolVersion: WORKER_PROTOCOL_VERSION }
        : { ok: true, data: { requestId: 'request-1', result: { schemaVersion: 99 } } },
    );
    const client = createProfileAuditClient({ sendMessage, timeoutMs: 25, wakeDelaysMs: [0] });

    await expect(
      client.start({ type: 'START_PROFILE_AUDIT', requestId: 'request-1' }),
    ).resolves.toEqual(runtimeError('protocol-error', 'Некорректный ответ аудита.', false));
  });

  it('passes through typed worker failures', async () => {
    const failure = runtimeError('not-authenticated', 'Авторизуйся в LinkedIn.', true);
    const sendMessage = vi.fn(async (message: unknown) =>
      (message as { type?: string }).type === 'PING'
        ? { type: 'PONG', protocolVersion: WORKER_PROTOCOL_VERSION }
        : failure,
    );
    const client = createProfileAuditClient({ sendMessage, timeoutMs: 25, wakeDelaysMs: [0] });

    await expect(
      client.start({ type: 'START_PROFILE_AUDIT', requestId: 'request-1' }),
    ).resolves.toEqual(failure);
  });

  it('bounds worker wake independently from the longer audit command', async () => {
    vi.useFakeTimers();
    try {
      const sendMessage = vi.fn(() => new Promise<unknown>(() => {}));
      const client = createProfileAuditClient({
        sendMessage,
        timeoutMs: 45_000,
        wakeTimeoutMs: 1_500,
        wakeDelaysMs: [0],
      });
      const response = client.start({ type: 'START_PROFILE_AUDIT', requestId: 'request-1' });

      await vi.advanceTimersByTimeAsync(1_500);

      await expect(response).resolves.toMatchObject({ ok: false, error: { code: 'timeout' } });
    } finally {
      vi.useRealTimers();
    }
  });
});
