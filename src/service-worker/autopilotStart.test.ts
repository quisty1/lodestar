import { describe, expect, it, vi } from 'vitest';
import { FakeStore } from '@lib/storage/fakeStore';
import { MODULE_STATE_VERSION_KEY, MODULES_STATE_KEY } from '@lib/modules/moduleState';
import { RUN_PAUSE_KEY } from '@lib/autopilot/runPause';
import { createAutopilotStart, type LaunchSteps } from './autopilotStart';
import type { WorkerContext } from './workerContext';

const steps = {} as LaunchSteps;

function context(
  store: FakeStore,
  begin = vi.fn(async () => ({ kind: 'already-running' as const })),
) {
  return {
    ctx: {
      store,
      clock: { now: () => new Date(2026, 9, 8, 11) },
      autopilotRng: { next: () => 0.5 },
      supervisor: { reconcile: vi.fn(async () => {}) },
      coordinator: { getState: vi.fn(async () => null), begin },
      targetDeps: { hasHostPermission: vi.fn(async () => true) },
    } as unknown as WorkerContext,
    begin,
  };
}

async function disabledModules(store: FakeStore) {
  await store.set(MODULES_STATE_KEY, [
    module('engagement', false),
    module('smart_connect', false),
    module('content', false),
    module('profile_views', false),
  ]);
  await store.set(MODULE_STATE_VERSION_KEY, 1);
}

describe('startAutopilot', () => {
  it('refuses to start when no module is enabled', async () => {
    const store = new FakeStore();
    await disabledModules(store);
    const { ctx, begin } = context(store);
    const result = await createAutopilotStart(ctx, steps)('tab');
    expect(result).toMatchObject({ ok: false, error: { code: 'no-modules' } });
    expect(begin).not.toHaveBeenCalled();
  });

  it('refuses to start while the run is paused until tomorrow', async () => {
    const store = new FakeStore();
    await store.set(RUN_PAUSE_KEY, '2026-10-09');
    const { ctx, begin } = context(store);
    const result = await createAutopilotStart(ctx, steps)('tab');
    expect(result).toMatchObject({ ok: false, error: { code: 'paused' } });
    expect(begin).not.toHaveBeenCalled();
  });

  it('refuses to start when a run is already active', async () => {
    const store = new FakeStore();
    const { ctx } = context(store);
    const result = await createAutopilotStart(ctx, steps)('tab');
    expect(result).toMatchObject({ ok: false, error: { code: 'already-running' } });
  });
});

function module(id: string, enabled: boolean) {
  return { id, enabled, automationLevel: 'manual', available: true, dailyLimit: 10 };
}
