import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeStore } from '@lib/storage/fakeStore';
import { VIEWING_PROFILES } from '@lib/autopilot/statusLabels';
import { createViewStep } from './runViewsStep';
import { navigateLinkedInTab, readTabMessage, setStage } from './linkedinTabBridge';
import { runViewWithFallback } from './viewHandlers';

vi.mock('./linkedinTabBridge', () => ({
  navigateLinkedInTab: vi.fn(async () => true),
  readTabMessage: vi.fn(async () => undefined),
  setStage: vi.fn(async () => {}),
}));

vi.mock('./viewHandlers', () => ({
  runViewWithFallback: vi.fn(
    async (deps: {
      navigate: (url: string) => Promise<boolean>;
      dwell: () => Promise<unknown>;
    }) => {
      await deps.navigate('https://www.linkedin.com/feed/');
      await deps.dwell();
      return { executed: 1, skipped: 0, reason: 'done' };
    },
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runViewsThen', () => {
  it('returns cancelled before opening a page', async () => {
    const step = createViewStep(deps());
    await expect(step.runViewsThen(7, 'run-1', async () => true)).resolves.toEqual({
      executed: 0,
      skipped: 0,
      reason: 'cancelled',
    });
    expect(runViewWithFallback).not.toHaveBeenCalled();
  });

  it('stages profile viewing and dwells through the tab bridge', async () => {
    const step = createViewStep(deps());
    await expect(step.runViewsThen(7, 'run-1', async () => false)).resolves.toMatchObject({
      executed: 1,
      reason: 'done',
    });
    expect(navigateLinkedInTab).toHaveBeenCalled();
    expect(setStage).toHaveBeenCalledWith(expect.anything(), 'run-1', 7, VIEWING_PROFILES);
    expect(readTabMessage).toHaveBeenCalledWith(7, {
      type: 'DWELL_PROFILE',
      runId: 'run-1',
      expectedUrl: 'https://www.linkedin.com/feed/',
    });
  });
});

function deps() {
  return {
    store: new FakeStore(),
    clock: { now: () => new Date(2026, 9, 8, 11) },
    coordinator: { isActive: async () => true },
    workerEffects: {},
    runFinalizer: {},
    targetDeps: {},
    contentSleep: vi.fn(async () => {}),
  } as never;
}
