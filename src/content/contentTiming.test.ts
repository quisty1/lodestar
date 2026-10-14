import { afterEach, describe, expect, it, vi } from 'vitest';
import { ask, send, sleepUntilCancelled } from './contentTiming';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sleepUntilCancelled', () => {
  it('returns immediately when the run is already aborted', async () => {
    vi.useFakeTimers();
    await expect(sleepUntilCancelled(5_000, () => true)).resolves.toBeUndefined();
  });

  it('resolves early when abort flips during the wait', async () => {
    vi.useFakeTimers();
    let abort = false;
    const pending = sleepUntilCancelled(5_000, () => abort);
    abort = true;
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBeUndefined();
  });

  it('waits out the full timeout when nothing aborts', async () => {
    vi.useFakeTimers();
    const pending = sleepUntilCancelled(1_000, () => false);
    await vi.advanceTimersByTimeAsync(999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });
});

describe('send and ask', () => {
  it('swallows a chrome.runtime rejection', async () => {
    const sendMessage = vi.fn(() => Promise.reject(new Error('no receiver')));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    expect(() => {
      send({ type: 'PING' });
    }).not.toThrow();
    await expect(ask({ type: 'PING' })).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('returns the runtime reply', async () => {
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn(async () => ({ ok: true })) },
    });
    await expect(ask<{ ok: boolean }>({ type: 'PING' })).resolves.toEqual({ ok: true });
  });
});
