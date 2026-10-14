import { describe, expect, it, vi } from 'vitest';
import { ContentRunSession } from './runSession';
import { runScopedContentLoop } from './runLoopLifecycle';

function deferred<T>() {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next as (value?: T | PromiseLike<T>) => void;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('runScopedContentLoop', () => {
  it('reports an unexpected owned-loop rejection as a scoped error end', async () => {
    const session = new ContentRunSession();
    session.begin('run-1');
    const endRun = vi.fn(async (runId: string) => {
      session.finish(runId);
    });

    await runScopedContentLoop('run-1', {
      session,
      execute: async () => {
        throw new Error('DOM changed');
      },
      endRun,
      teardown: vi.fn(async () => undefined),
      clearActivity: vi.fn(),
    });

    expect(endRun).toHaveBeenCalledExactlyOnceWith('run-1', 'error');
  });

  it('cannot tear down page state owned by a restarted run', async () => {
    const session = new ContentRunSession();
    session.begin('run-1');
    const execution = deferred<undefined>();
    const teardown = vi.fn(async () => undefined);
    let visibleActivity: string | null = 'run-1';
    const clearActivity = vi.fn(() => {
      visibleActivity = null;
    });
    const endRun = vi.fn(async () => undefined);
    const oldLoop = runScopedContentLoop('run-1', {
      session,
      execute: () => execution.promise,
      endRun,
      teardown,
      clearActivity,
    });

    expect(session.stop('run-1')).toBe(true);
    visibleActivity = null;
    expect(session.attach('run-2')).toBe('attached');
    visibleActivity = 'run-2';
    execution.resolve();
    await oldLoop;

    expect(session.activeRunId).toBe('run-2');
    expect(endRun).not.toHaveBeenCalled();
    expect(teardown).not.toHaveBeenCalled();
    expect(clearActivity).not.toHaveBeenCalled();
    expect(visibleActivity).toBe('run-2');
  });
});
