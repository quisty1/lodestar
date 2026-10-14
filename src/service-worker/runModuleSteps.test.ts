import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeStore } from '@lib/storage/fakeStore';
import { ACCEPTING } from '@lib/autopilot/statusLabels';
import { createModuleSteps } from './runModuleSteps';
import { navigateLinkedInTab, readTabMessage, setStage } from './linkedinTabBridge';

vi.mock('./linkedinTabBridge', () => ({
  navigateLinkedInTab: vi.fn(async () => true),
  readTabMessage: vi.fn(async () => ({ ok: true, accepted: 4 })),
  setStage: vi.fn(async () => {}),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runAcceptThen', () => {
  it('returns zero before navigating when the run is cancelled', async () => {
    const steps = createModuleSteps(deps());
    await expect(steps.runAcceptThen(7, 'run-1', async () => true)).resolves.toBe(0);
    expect(navigateLinkedInTab).not.toHaveBeenCalled();
  });

  it('navigates, stages accepting, then reads the accept count', async () => {
    const steps = createModuleSteps(deps());
    await expect(steps.runAcceptThen(7, 'run-1', async () => false)).resolves.toBe(4);
    expect(navigateLinkedInTab).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      7,
      'https://www.linkedin.com/mynetwork/invitation-manager/received/',
      'run-1',
    );
    expect(setStage).toHaveBeenCalledWith(expect.anything(), 'run-1', 7, ACCEPTING);
    expect(readTabMessage).toHaveBeenCalledWith(7, {
      type: 'ACCEPT_INCOMING',
      runId: 'run-1',
      cap: 15,
    });
    const navOrder = vi.mocked(navigateLinkedInTab).mock.invocationCallOrder[0] ?? 0;
    const stageOrder = vi.mocked(setStage).mock.invocationCallOrder[0] ?? 0;
    const readOrder = vi.mocked(readTabMessage).mock.invocationCallOrder[0] ?? 0;
    expect(navOrder).toBeLessThan(stageOrder);
    expect(stageOrder).toBeLessThan(readOrder);
  });
});

function deps() {
  return {
    store: new FakeStore(),
    clock: { now: () => new Date(2026, 9, 8, 11) },
    coordinator: { isActive: async () => true, setStage: async () => ({}) },
    workerEffects: {},
    runFinalizer: {},
    targetDeps: {},
  } as never;
}
