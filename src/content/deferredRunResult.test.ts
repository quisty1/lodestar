import { describe, expect, it, vi } from 'vitest';
import { ContentRunSession } from './runSession';
import { settleRunDecision, settleRunResult } from './deferredRunResult';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('settleRunResult', () => {
  it('drops a deferred LLM result when STOP lands before the response', async () => {
    const session = new ContentRunSession();
    session.attach('run-1');
    const response = deferred<{ ok: boolean; text: string }>();
    const apply = vi.fn(async () => true);
    const settling = settleRunResult(session, 'run-1', response.promise, apply);

    session.stop('run-1');
    response.resolve({ ok: true, text: 'late comment' });

    expect(await settling).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies a response while the same run remains active', async () => {
    const session = new ContentRunSession();
    session.attach('run-1');
    const apply = vi.fn(async (value: number) => value + 1);

    expect(await settleRunResult(session, 'run-1', Promise.resolve(2), apply)).toBe(3);
    expect(apply).toHaveBeenCalledWith(2);
  });

  it('preserves a natural stop decision when STOP closes the session before MAY_ACT resolves', async () => {
    const session = new ContentRunSession();
    session.attach('run-1');
    const response = deferred<{ action: 'stop'; reason: 'budget' }>();
    const settling = settleRunDecision(session, 'run-1', response.promise);

    session.stop('run-1');
    response.resolve({ action: 'stop', reason: 'budget' });

    await expect(settling).resolves.toEqual({ action: 'stop', reason: 'budget' });
  });
});
