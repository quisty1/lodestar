import { describe, expect, it, vi } from 'vitest';
import type { AutopilotStatus } from '@lib/types';
import { continueAutopilotStart, type StartContinuationDependencies } from './startContinuation';
import { contentPong } from './contentPong.test-fixture';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function setup(overrides: Partial<StartContinuationDependencies> = {}) {
  const launch = vi.fn(async () => undefined);
  const status: AutopilotStatus = {
    running: true,
    used: 0,
    ceiling: 30,
    revision: 1,
    runId: 'run-1',
  };
  const dependencies: StartContinuationDependencies = {
    prepareFeed: vi.fn(async () => ({ ok: true as const, tabId: 7, pong: contentPong() })),
    isActive: vi.fn(async () => true),
    prepareLaunch: vi.fn(async () => launch),
    trackLaunch: vi.fn(),
    status: vi.fn(async () => status),
    ...overrides,
  };
  return { dependencies, launch, status };
}

describe('continueAutopilotStart', () => {
  it('does not preflight a run that already lost ownership', async () => {
    const { dependencies } = setup({ isActive: vi.fn(async () => false) });

    await expect(continueAutopilotStart('run-1', dependencies)).resolves.toEqual({ kind: 'stale' });
    expect(dependencies.prepareFeed).not.toHaveBeenCalled();
    expect(dependencies.prepareLaunch).not.toHaveBeenCalled();
  });

  it('does not launch or claim success when Stop wins during initial preflight', async () => {
    const preflight = deferred<Awaited<ReturnType<StartContinuationDependencies['prepareFeed']>>>();
    let active = true;
    const { dependencies, launch } = setup({
      prepareFeed: vi.fn(() => preflight.promise),
      isActive: vi.fn(async () => active),
    });
    const result = continueAutopilotStart('run-1', dependencies);
    active = false;
    preflight.resolve({ ok: true, tabId: 7, pong: contentPong() });

    await expect(result).resolves.toEqual({ kind: 'stale' });
    expect(dependencies.prepareLaunch).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(dependencies.trackLaunch).not.toHaveBeenCalled();
  });

  it('rechecks ownership immediately before invoking the prepared launch', async () => {
    const preparedLaunch = deferred<() => Promise<void>>();
    let active = true;
    const { dependencies, launch } = setup({
      isActive: vi.fn(async () => active),
      prepareLaunch: vi.fn(() => preparedLaunch.promise),
    });
    const result = continueAutopilotStart('run-1', dependencies);
    await vi.waitFor(() => {
      expect(dependencies.prepareLaunch).toHaveBeenCalledOnce();
    });
    active = false;
    preparedLaunch.resolve(launch);

    await expect(result).resolves.toEqual({ kind: 'stale' });
    expect(launch).not.toHaveBeenCalled();
    expect(dependencies.trackLaunch).not.toHaveBeenCalled();
  });

  it('tracks a successful launch and returns only its matching active status', async () => {
    const { dependencies, launch, status } = setup();

    await expect(continueAutopilotStart('run-1', dependencies)).resolves.toEqual({
      kind: 'started',
      status,
    });
    expect(launch).toHaveBeenCalledOnce();
    expect(dependencies.trackLaunch).toHaveBeenCalledWith('run-1', expect.any(Promise));
  });

  it('rechecks ownership and does not claim success when finalization wins before the response', async () => {
    const isActive = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { dependencies, launch } = setup({ isActive });

    await expect(continueAutopilotStart('run-1', dependencies)).resolves.toEqual({ kind: 'stale' });
    expect(launch).toHaveBeenCalledOnce();
    expect(dependencies.trackLaunch).toHaveBeenCalledOnce();
    expect(isActive).toHaveBeenCalledTimes(4);
  });
});
