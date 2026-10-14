import { describe, expect, it, vi } from 'vitest';
import { RunCoordinator } from '@lib/autopilot/RunCoordinator';
import { RunReportStore } from '@lib/autopilot/RunReportStore';
import type { Clock, KeyValueStore } from '@lib/ports';
import {
  launchAutopilotRun,
  NavigationFailedError,
  openFeedLoop,
  type RunLaunchDependencies,
} from './runLauncher';
import { contentPong } from './contentPong.test-fixture';

function setup(loop = false) {
  const values = new Map<string, unknown>();
  const store: KeyValueStore = {
    async get<T>(key: string) {
      return (values.get(key) as T | undefined) ?? null;
    },
    async set<T>(key: string, value: T) {
      values.set(key, value);
    },
  };
  const clock: Clock = { now: () => new Date('2026-08-11T10:00:00.000Z') };
  const reports = new RunReportStore(store);
  const coordinator = new RunCoordinator({
    store,
    clock,
    reports,
    createId: () => 'run-1',
  });
  const deps: RunLaunchDependencies = {
    coordinator,
    runViews: vi.fn(async () => ({ executed: 2, reason: 'done' })),
    runConnect: vi.fn(async () => ({ executed: 3, reason: 'done' })),
    runPublishing: vi.fn(async () => ({ executed: 1, reason: 'done' })),
    prepareFeed: vi.fn(async () => ({
      ok: true as const,
      tabId: 7,
      pong: contentPong(),
    })),
    startFeedLoop: vi.fn(async () => ({ ok: true as const })),
    finalize: vi.fn(async (runId, reason) => {
      await coordinator.requestStop(runId, reason);
      await coordinator.finalize(runId);
    }),
    startKeepAlive: vi.fn(() => vi.fn()),
    clearActivity: vi.fn(async () => undefined),
  };
  const config = {
    tabId: 7,
    enabled: {
      engagement: loop,
      profileViews: true,
      smartConnect: true,
      content: loop,
    },
    loopModules: { engagement: loop, content: loop, comments: false },
    labels: { scanning: 'scan', collecting: 'collect' },
  };
  return { coordinator, reports, deps, config };
}

async function begin(coordinator: RunCoordinator) {
  const started = await coordinator.begin({
    requestId: 'request-1',
    host: 'tab',
    day: '2026-08-11',
    ceiling: 30,
    used: 4,
    tabId: 7,
  });
  if (started.kind !== 'started') throw new Error('start failed');
  return started.runId;
}

describe('launchAutopilotRun', () => {
  it('runs ordered phases and finalizes a pre-loop-only run exactly once', async () => {
    const { coordinator, reports, deps, config } = setup(false);
    const runId = await begin(coordinator);

    await launchAutopilotRun(runId, config, deps);

    expect(deps.runViews).toHaveBeenCalledOnce();
    expect(deps.runConnect).toHaveBeenCalledOnce();
    expect(deps.runPublishing).toHaveBeenCalledOnce();
    expect(deps.startFeedLoop).not.toHaveBeenCalled();
    expect(deps.finalize).toHaveBeenCalledWith(runId, 'completed');
    expect(await reports.list()).toHaveLength(1);
  });

  it('preflights feed, starts the scoped loop and leaves its run active', async () => {
    const { coordinator, reports, deps, config } = setup(true);
    const runId = await begin(coordinator);

    await launchAutopilotRun(runId, config, deps);

    expect(deps.prepareFeed).toHaveBeenCalledWith(runId);
    expect(deps.startFeedLoop).toHaveBeenCalledWith(runId, config.loopModules);
    expect(await coordinator.getState()).toMatchObject({
      running: true,
      phase: 'feed_loop',
      runId,
    });
    expect(await reports.list()).toEqual([]);
    expect(deps.clearActivity).not.toHaveBeenCalled();
  });

  it('finalizes navigation failure instead of silently rolling back state', async () => {
    const { coordinator, reports, deps, config } = setup(true);
    const runId = await begin(coordinator);
    deps.prepareFeed = vi.fn(async () => ({
      ok: false as const,
      reason: 'navigation_failed' as const,
    }));

    await launchAutopilotRun(runId, config, deps);

    expect(deps.startFeedLoop).not.toHaveBeenCalled();
    expect(deps.finalize).toHaveBeenCalledWith(runId, 'navigation_failed');
    expect((await reports.list())[0]?.stopReason).toBe('navigation_failed');
    expect(deps.clearActivity).toHaveBeenCalledOnce();
  });

  it('still searches and connects when accepting incoming invites fails to land', async () => {
    const { coordinator, deps, config } = setup(false);
    const runId = await begin(coordinator);
    deps.runAccept = vi.fn(async () => {
      throw new NavigationFailedError();
    });

    await launchAutopilotRun(runId, config, deps);

    expect(deps.runAccept).toHaveBeenCalledOnce();
    expect(deps.runConnect).toHaveBeenCalledOnce();
    expect(deps.finalize).toHaveBeenCalledWith(runId, 'completed');
  });

  it('maps a pre-loop return-navigation exception to navigation_failed', async () => {
    const { coordinator, deps, config } = setup(false);
    const runId = await begin(coordinator);
    deps.runConnect = vi.fn(async () => {
      throw new NavigationFailedError();
    });

    await launchAutopilotRun(runId, config, deps);

    expect(deps.finalize).toHaveBeenCalledWith(runId, 'navigation_failed');
  });

  it('starts no later phase after the stop barrier lands', async () => {
    const { coordinator, deps, config } = setup(false);
    const runId = await begin(coordinator);
    deps.runViews = vi.fn(async () => {
      await coordinator.requestStop(runId, 'manual');
      return { executed: 1, reason: 'done' };
    });

    await launchAutopilotRun(runId, config, deps);

    expect(deps.runConnect).not.toHaveBeenCalled();
    expect(deps.runPublishing).not.toHaveBeenCalled();
    expect(deps.clearActivity).toHaveBeenCalledOnce();
  });

  it('does not enter a phase when stop wins between the active check and phase write', async () => {
    const { coordinator, deps, config } = setup(false);
    const runId = await begin(coordinator);
    vi.spyOn(coordinator, 'setPhase').mockImplementationOnce(async () => {
      await coordinator.requestStop(runId, 'manual');
      return null;
    });

    await launchAutopilotRun(runId, config, deps);

    expect(deps.runViews).not.toHaveBeenCalled();
    expect(deps.runConnect).not.toHaveBeenCalled();
  });

  it('records a wrong page as navigation failure instead of a markup change', async () => {
    const { coordinator, deps, config } = setup(true);
    const runId = await begin(coordinator);
    deps.startFeedLoop = vi.fn(async () => ({
      ok: false as const,
      reason: 'navigation_failed' as const,
    }));

    await launchAutopilotRun(runId, config, deps);

    expect(deps.finalize).toHaveBeenCalledWith(runId, 'navigation_failed');
  });

  it('clears keepalive and activity after an unexpected phase error', async () => {
    const { coordinator, deps, config } = setup(false);
    const runId = await begin(coordinator);
    const stopKeepAlive = vi.fn();
    deps.startKeepAlive = vi.fn(() => stopKeepAlive);
    deps.runViews = vi.fn(async () => {
      throw new Error('boom');
    });

    await launchAutopilotRun(runId, config, deps);

    expect(deps.finalize).toHaveBeenCalledWith(runId, 'error');
    expect(stopKeepAlive).toHaveBeenCalledOnce();
    expect(deps.clearActivity).toHaveBeenCalledOnce();
  });
});

describe('openFeedLoop', () => {
  it('attaches once and retries when the content loop is not attached', async () => {
    const runLoop = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, runId: 'run-1', error: 'run-not-attached' })
      .mockResolvedValueOnce({ ok: true, runId: 'run-1' });
    const attach = vi.fn(async () => ({ ok: true, runId: 'run-1' }));

    await expect(openFeedLoop({ runId: 'run-1', runLoop, attach })).resolves.toEqual({ ok: true });
    expect(attach).toHaveBeenCalledOnce();
    expect(runLoop).toHaveBeenCalledTimes(2);
  });

  it('does not call a wrong page a markup change', async () => {
    const runLoop = vi.fn(async () => ({ ok: false, error: 'wrong-page' }));

    await expect(
      openFeedLoop({
        runId: 'run-1',
        runLoop,
        attach: vi.fn(),
      }),
    ).resolves.toEqual({ ok: false, reason: 'navigation_failed' });
  });

  it('keeps a real feed markup failure', async () => {
    await expect(
      openFeedLoop({
        runId: 'run-1',
        runLoop: async () => ({ ok: false, error: 'unsupported_dom' }),
        attach: vi.fn(),
      }),
    ).resolves.toEqual({ ok: false, reason: 'unsupported_dom' });
  });
});
