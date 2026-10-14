import { describe, expect, it, vi } from 'vitest';
import type { AutopilotState, RunReport } from '@lib/types';
import { recoverPersistedEffects } from './effectRecovery';

function state(phase: AutopilotState['phase']): AutopilotState {
  return {
    running: phase !== 'finished',
    host: 'tab',
    tabId: 7,
    day: '2026-08-11',
    ceiling: 10,
    used: 0,
    actionTimestamps: [],
    actionsSinceBreak: 0,
    manualStop: false,
    startedAt: '2026-08-11T10:00:00.000Z',
    runId: 'run-1',
    startRequestId: 'start-1',
    phase,
    startedUsed: 0,
    riskMarkers: [],
    updatedAt: '2026-08-11T10:00:00.000Z',
    effectLedger: { version: 1, active: {}, receipts: {} },
  };
}

describe('recoverPersistedEffects', () => {
  it('does not rebroadcast an already-finished report on cold evaluation', async () => {
    const recover = vi.fn(async () => ({ id: 'run-1' }) as RunReport);
    const broadcast = vi.fn();

    await expect(
      recoverPersistedEffects({
        getState: async () => state('finished'),
        finish: vi.fn(),
        recover,
        broadcast,
      }),
    ).resolves.toBeNull();

    expect(recover).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('routes a cold stopping snapshot through the effect finalizer', async () => {
    const stopping = state('stopping');
    const finish = vi.fn(async () => undefined);
    const recover = vi.fn();

    await recoverPersistedEffects({
      getState: async () => stopping,
      finish,
      recover,
      broadcast: vi.fn(),
    });

    expect(finish).toHaveBeenCalledWith('run-1', stopping);
    expect(recover).not.toHaveBeenCalled();
  });
});
