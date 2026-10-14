import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKER_PROTOCOL_VERSION, runtimeError, runtimeOk } from '@lib/runtimeProtocol';
import { createRuntimeClient } from './runtimeClient';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const stopped = { running: false, used: 0, ceiling: 30, revision: 0 };
const running = {
  ...stopped,
  running: true,
  revision: 1,
  runId: 'run-1',
  phase: 'starting' as const,
  recoveryRequired: false,
};
const pong = { type: 'PONG', protocolVersion: WORKER_PROTOCOL_VERSION };

describe('sidepanel runtime client', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    // Fails the suite when a test leaves fake timers running.
    // eslint-disable-next-line vitest/no-standalone-expect
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('wakes a cold worker after a lost first PING, then sends the command once', async () => {
    const calls: unknown[] = [];
    const sendMessage = vi.fn(async (message: unknown) => {
      calls.push(message);
      if (calls.length === 1) throw new Error('receiving end does not exist');
      if (calls.length === 2) return pong;
      return runtimeOk(stopped);
    });
    const client = createRuntimeClient({ sendMessage, timeoutMs: 25 });

    const resultPromise = client.status();
    await vi.advanceTimersByTimeAsync(100);

    await expect(resultPromise).resolves.toEqual(runtimeOk(stopped));
    expect(calls).toEqual([{ type: 'PING' }, { type: 'PING' }, { type: 'GET_AUTOPILOT_STATUS' }]);
  });

  it('retries a lost command response with the exact same request object and requestId', async () => {
    const request = {
      type: 'START_AUTOPILOT' as const,
      host: 'tab' as const,
      requestId: 'request-1',
    };
    const commandCalls: unknown[] = [];
    const sendMessage = vi.fn(async (message: unknown) => {
      if ((message as { type?: string }).type === 'PING') return pong;
      commandCalls.push(message);
      if (commandCalls.length === 1) throw new Error('message port closed');
      return runtimeOk({
        started: true as const,
        duplicate: true,
        runId: 'run-1',
        status: running,
      });
    });
    const client = createRuntimeClient({ sendMessage, timeoutMs: 25 });

    await expect(client.start(request)).resolves.toMatchObject({
      ok: true,
      data: { duplicate: true, runId: 'run-1' },
    });
    expect(commandCalls).toHaveLength(2);
    expect(commandCalls[0]).toBe(request);
    expect(commandCalls[1]).toBe(request);
  });

  it('does not time out or retry START during the production feed preflight window', async () => {
    const preflight = deferred<unknown>();
    const request = {
      type: 'START_AUTOPILOT' as const,
      host: 'tab' as const,
      requestId: 'request-long',
    };
    const commandCalls: unknown[] = [];
    const sendMessage = vi.fn((message: unknown) => {
      if ((message as { type?: string }).type === 'PING') return Promise.resolve(pong);
      commandCalls.push(message);
      return preflight.promise;
    });
    const client = createRuntimeClient({ sendMessage });
    let settled = false;

    const resultPromise = client.start(request).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(31_000);

    expect(settled).toBe(false);
    expect(commandCalls).toEqual([request]);

    preflight.resolve(
      runtimeOk({ started: true as const, duplicate: false, runId: 'run-1', status: running }),
    );
    await expect(resultPromise).resolves.toMatchObject({ ok: true, data: { runId: 'run-1' } });
  });

  it('retries a timed-out START with the same request and preserves its late exact failure', async () => {
    const completion = deferred<unknown>();
    const request = {
      type: 'START_AUTOPILOT' as const,
      host: 'tab' as const,
      requestId: 'request-timeout',
    };
    const commandCalls: unknown[] = [];
    const sendMessage = vi.fn((message: unknown) => {
      if ((message as { type?: string }).type === 'PING') return Promise.resolve(pong);
      commandCalls.push(message);
      return completion.promise;
    });
    const client = createRuntimeClient({
      sendMessage,
      timeouts: { wake: 10, status: 20, start: 40, stop: 30 },
    });

    const resultPromise = client.start(request);
    await vi.advanceTimersByTimeAsync(40);

    expect(commandCalls).toHaveLength(2);
    expect(commandCalls[0]).toBe(request);
    expect(commandCalls[1]).toBe(request);

    const failure = runtimeError('navigation-failed', 'LinkedIn feed did not finish loading', true);
    completion.resolve(failure);
    await expect(resultPromise).resolves.toEqual(failure);
  });

  it('keeps status and STOP timeouts independently bounded', async () => {
    const sendMessage = vi.fn((message: unknown) => {
      if ((message as { type?: string }).type === 'PING') return Promise.resolve(pong);
      return new Promise<unknown>(() => {});
    });
    const client = createRuntimeClient({
      sendMessage,
      timeouts: { wake: 10, status: 20, start: 100, stop: 30 },
    });

    const statusPromise = client.status();
    await vi.advanceTimersByTimeAsync(50);
    await expect(statusPromise).resolves.toMatchObject({ ok: false, error: { code: 'timeout' } });

    const stopPromise = client.stop({ type: 'STOP_AUTOPILOT', runId: 'run-1' });
    await vi.advanceTimersByTimeAsync(70);
    await expect(stopPromise).resolves.toMatchObject({ ok: false, error: { code: 'timeout' } });
  });

  it('returns a typed transport failure after all wake attempts are exhausted', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('worker unavailable');
    });
    const client = createRuntimeClient({ sendMessage, timeoutMs: 25 });

    const resultPromise = client.status();
    await vi.advanceTimersByTimeAsync(400);

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      error: { code: 'transport-error', retryable: true },
    });
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('turns exhausted per-call timers into a typed timeout and clears every timer', async () => {
    const pending: Array<ReturnType<typeof deferred<unknown>>> = [];
    const sendMessage = vi.fn(() => {
      const call = deferred<unknown>();
      pending.push(call);
      return call.promise;
    });
    const client = createRuntimeClient({ sendMessage, timeoutMs: 20 });

    const resultPromise = client.status();
    await vi.advanceTimersByTimeAsync(500);

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      error: { code: 'timeout', retryable: true },
    });
    expect(pending).toHaveLength(3);
  });

  it('rejects a malformed command envelope as a protocol failure without retrying', async () => {
    const sendMessage = vi.fn(async (message: unknown) =>
      (message as { type?: string }).type === 'PING' ? pong : { started: true },
    );
    const client = createRuntimeClient({ sendMessage, timeoutMs: 25 });

    await expect(client.status()).resolves.toMatchObject({
      ok: false,
      error: { code: 'protocol-error', retryable: false },
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['unknown phase', { ...stopped, phase: 'teleporting' }],
    ['unknown stop reason', { ...stopped, stopReason: 'maybe' }],
    ['missing running runId', { ...running, runId: '' }],
    ['invalid revision', { ...stopped, revision: -1 }],
    ['running status without a phase', { ...running, phase: undefined }],
    ['scoped status without a phase', { ...stopped, runId: 'run-1' }],
    ['phase without a runId', { ...stopped, phase: 'finished' }],
    ['stopping status still running', { ...running, phase: 'stopping', recoveryRequired: true }],
    [
      'finalizing status still running',
      { ...running, phase: 'finalizing', recoveryRequired: true },
    ],
    ['finished status still running', { ...running, phase: 'finished' }],
    ['active status marked for recovery', { ...running, recoveryRequired: true }],
    [
      'stopping status missing recovery marker',
      { ...stopped, revision: 2, runId: 'run-1', phase: 'stopping' },
    ],
    [
      'finalizing status with recovery disabled',
      { ...stopped, revision: 3, runId: 'run-1', phase: 'finalizing', recoveryRequired: false },
    ],
    [
      'inactive status in an active phase',
      { ...stopped, revision: 2, runId: 'run-1', phase: 'feed_loop', recoveryRequired: false },
    ],
    [
      'finished status marked for recovery',
      { ...stopped, revision: 4, runId: 'run-1', phase: 'finished', recoveryRequired: true },
    ],
  ])('rejects status with %s as a protocol failure', async (_label, malformed) => {
    const sendMessage = vi.fn(async (message: unknown) =>
      (message as { type?: string }).type === 'PING' ? pong : runtimeOk(malformed),
    );
    const client = createRuntimeClient({ sendMessage, timeoutMs: 25 });

    await expect(client.status()).resolves.toMatchObject({
      ok: false,
      error: { code: 'protocol-error', retryable: false },
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['legacy idle status', stopped],
    ['legacy idle status with explicit recovery false', { ...stopped, recoveryRequired: false }],
    ['legacy recovery status', { ...stopped, recoveryRequired: true }],
    ['active scoped status', running],
    [
      'stopping scoped status',
      { ...stopped, revision: 2, runId: 'run-1', phase: 'stopping', recoveryRequired: true },
    ],
    [
      'finalizing scoped status',
      { ...stopped, revision: 3, runId: 'run-1', phase: 'finalizing', recoveryRequired: true },
    ],
    [
      'finished scoped status',
      { ...stopped, revision: 4, runId: 'run-1', phase: 'finished', recoveryRequired: false },
    ],
  ])('accepts %s from protocol v2', async (_label, status) => {
    const sendMessage = vi.fn(async (message: unknown) =>
      (message as { type?: string }).type === 'PING' ? pong : runtimeOk(status),
    );
    const client = createRuntimeClient({ sendMessage, timeoutMs: 25 });

    await expect(client.status()).resolves.toEqual(runtimeOk(status));
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('rejects a START runId that does not match its returned status', async () => {
    const request = {
      type: 'START_AUTOPILOT' as const,
      host: 'tab' as const,
      requestId: 'request-mismatch',
    };
    const sendMessage = vi.fn(async (message: unknown) =>
      (message as { type?: string }).type === 'PING'
        ? pong
        : runtimeOk({
            started: true as const,
            duplicate: false,
            runId: 'run-1',
            status: { ...running, runId: 'run-2' },
          }),
    );
    const client = createRuntimeClient({ sendMessage, timeoutMs: 25 });

    await expect(client.start(request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'protocol-error', retryable: false },
    });
  });

  it('rejects a STOP runId that does not match its returned status', async () => {
    const request = { type: 'STOP_AUTOPILOT' as const, runId: 'run-1' };
    const sendMessage = vi.fn(async (message: unknown) =>
      (message as { type?: string }).type === 'PING'
        ? pong
        : runtimeOk({
            stopped: true,
            runId: 'run-1',
            status: {
              ...stopped,
              revision: 2,
              runId: 'run-2',
              phase: 'finished',
              stopReason: 'manual',
            },
          }),
    );
    const client = createRuntimeClient({ sendMessage, timeoutMs: 25 });

    await expect(client.stop(request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'protocol-error', retryable: false },
    });
  });

  it('rejects a PONG from a different protocol version', async () => {
    const sendMessage = vi.fn(async () => ({
      type: 'PONG',
      protocolVersion: WORKER_PROTOCOL_VERSION + 1,
    }));
    const client = createRuntimeClient({ sendMessage, timeoutMs: 25 });

    await expect(client.status()).resolves.toMatchObject({
      ok: false,
      error: { code: 'protocol-error', retryable: false },
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
