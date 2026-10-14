import { describe, expect, it, vi } from 'vitest';
import type { AutopilotState } from '@lib/types';
import {
  RunSupervisor,
  startWorkerKeepAlive,
  type RunSupervisorDependencies,
} from './runSupervisor';
import { contentPong } from './contentPong.test-fixture';

function state(overrides: Partial<AutopilotState> = {}): AutopilotState {
  return {
    running: true,
    host: 'tab',
    tabId: 7,
    day: '2026-08-11',
    ceiling: 30,
    used: 0,
    actionTimestamps: [],
    actionsSinceBreak: 0,
    manualStop: false,
    startedAt: '2026-08-11T10:00:00.000Z',
    runId: 'run-1',
    startRequestId: 'request-1',
    phase: 'feed_loop',
    startedUsed: 0,
    riskMarkers: [],
    updatedAt: '2026-08-11T10:00:00.000Z',
    ...overrides,
  };
}

function dependencies(current: AutopilotState | null): RunSupervisorDependencies {
  return {
    getState: vi.fn(async () => current),
    recoverInterrupted: vi.fn(async () => null),
    finalizeInterrupted: vi.fn(async () => undefined),
    getTab: vi.fn(async () => ({
      id: 7,
      url: 'https://www.linkedin.com/feed/',
      status: 'complete' as const,
    })),
    ping: vi.fn(async () => contentPong({ activeRunId: 'run-1' })),
  };
}

describe('RunSupervisor', () => {
  it('keeps a feed-loop run alive only when the target PONG matches its run id', async () => {
    const deps = dependencies(state());

    await new RunSupervisor(deps).reconcile();

    expect(deps.finalizeInterrupted).not.toHaveBeenCalled();
  });

  it('interrupts a feed-loop run when the target content loop is absent', async () => {
    const deps = dependencies(state());
    deps.ping = vi.fn(async () => null);

    await new RunSupervisor(deps).reconcile();

    expect(deps.finalizeInterrupted).toHaveBeenCalledWith('run-1');
  });

  it('interrupts a pre-loop run after worker restart when no local launch owns it', async () => {
    const deps = dependencies(state({ phase: 'smart_connect' }));

    await new RunSupervisor(deps).reconcile();

    expect(deps.finalizeInterrupted).toHaveBeenCalledWith('run-1');
  });

  it('preserves a pre-loop run while its local launch promise is tracked', async () => {
    const deps = dependencies(state({ phase: 'smart_connect' }));
    const supervisor = new RunSupervisor(deps);
    supervisor.trackLaunch('run-1', new Promise(() => {}));

    await supervisor.reconcile();

    expect(deps.finalizeInterrupted).not.toHaveBeenCalled();
  });

  it('protects an in-flight START preflight until its local claim is released', async () => {
    const deps = dependencies(state({ phase: 'starting' }));
    const supervisor = new RunSupervisor(deps);
    const release = supervisor.claimLaunch('run-1');

    await supervisor.reconcile();
    expect(deps.finalizeInterrupted).not.toHaveBeenCalled();

    release();
    await supervisor.reconcile();
    expect(deps.finalizeInterrupted).toHaveBeenCalledWith('run-1');
  });

  it('recovers legacy or terminal persisted state through the coordinator', async () => {
    const deps = dependencies(state({ phase: 'stopping', running: false }));

    await new RunSupervisor(deps).reconcile();

    expect(deps.recoverInterrupted).toHaveBeenCalledOnce();
  });

  it('routes an unknown future phase through coordinator recovery', async () => {
    const deps = dependencies(state({ phase: 'future-phase' as AutopilotState['phase'] }));

    await new RunSupervisor(deps).reconcile();

    expect(deps.recoverInterrupted).toHaveBeenCalledOnce();
    expect(deps.finalizeInterrupted).not.toHaveBeenCalled();
  });

  it('interrupts only the matching feed target when its tab closes or leaves feed', async () => {
    const deps = dependencies(state());
    const supervisor = new RunSupervisor(deps);

    await supervisor.onTabRemoved(9);
    await supervisor.onTabUpdated(9, { url: 'https://example.com/' });
    expect(deps.finalizeInterrupted).not.toHaveBeenCalled();

    await supervisor.onTabUpdated(7, { url: 'https://www.linkedin.com/in/me/' });
    expect(deps.finalizeInterrupted).toHaveBeenCalledWith('run-1');
  });

  it('does not interrupt a feed loop while its tab is still loading', async () => {
    const deps = dependencies(state());
    deps.ping = vi.fn(async () => null);
    const supervisor = new RunSupervisor(deps);

    await supervisor.onTabUpdated(7, { status: 'loading' });

    expect(deps.finalizeInterrupted).not.toHaveBeenCalled();
    expect(deps.ping).not.toHaveBeenCalled();
  });

  it('keeps a reloaded feed loop when a later ping recovers the run', async () => {
    const deps = dependencies(state());
    let pings = 0;
    deps.ping = vi.fn(async () => {
      pings += 1;
      return pings < 2 ? null : contentPong({ activeRunId: 'run-1' });
    });
    deps.reinject = vi.fn(async () => true);
    deps.sleep = vi.fn(async () => undefined);
    const supervisor = new RunSupervisor(deps);

    await supervisor.onTabUpdated(7, { status: 'complete' });

    expect(deps.finalizeInterrupted).not.toHaveBeenCalled();
    expect(deps.reinject).toHaveBeenCalledWith(7);
  });

  it('interrupts a same-URL feed reload when the content loop never answers', async () => {
    const deps = dependencies(state());
    deps.ping = vi.fn(async () => null);
    deps.reinject = vi.fn(async () => true);
    deps.sleep = vi.fn(async () => undefined);
    const supervisor = new RunSupervisor(deps);

    await supervisor.onTabUpdated(7, { status: 'complete' });

    expect(deps.ping).toHaveBeenCalledTimes(3);
    expect(deps.reinject).toHaveBeenCalledOnce();
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.finalizeInterrupted).toHaveBeenCalledExactlyOnceWith('run-1');
  });
});

describe('worker keep-alive', () => {
  it('pings an extension API every interval and clears the timer', async () => {
    vi.useFakeTimers();
    const ping = vi.fn(async () => undefined);

    const stop = startWorkerKeepAlive(ping, 25_000);
    await vi.advanceTimersByTimeAsync(50_000);
    stop();
    await vi.advanceTimersByTimeAsync(25_000);

    expect(ping).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
