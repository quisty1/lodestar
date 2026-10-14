import { isScopedAutopilotState } from '@lib/autopilot/RunCoordinator';
import type { AutopilotState } from '@lib/types';

export const EFFECT_RETRY_ALARM = 'lodestar:autopilot-effect-retry';
const MIN_RETRY_DELAY_MS = 60_000;

interface EffectRetryAlarmChrome {
  alarms: {
    create(name: string, alarmInfo: { when: number }): void;
    clear(name: string): boolean | Promise<boolean>;
    onAlarm: {
      addListener(listener: (alarm: { name: string }) => void): void;
    };
  };
}

export interface EffectRetryAlarm {
  schedule(delayMs: number): void;
  clear(): void;
}

export async function recoverEffectRetry(dependencies: {
  getState(): Promise<AutopilotState | null>;
  finish(runId: string, state: AutopilotState): Promise<void>;
  clear(): void;
}): Promise<void> {
  const state = await dependencies.getState();
  if (
    !isScopedAutopilotState(state) ||
    (state.phase !== 'stopping' && state.phase !== 'finalizing')
  ) {
    dependencies.clear();
    return;
  }
  await dependencies.finish(state.runId, state);
}

/** Durable MV3 backstop for finalizer retries; the in-memory timer remains the fast path. */
export function registerEffectRetryAlarm(
  chromeApi: EffectRetryAlarmChrome,
  dependencies: { recover(): void | Promise<void>; now?: () => number },
): EffectRetryAlarm {
  const run = () => {
    void Promise.resolve()
      .then(() => dependencies.recover())
      .catch(() => undefined);
  };
  chromeApi.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === EFFECT_RETRY_ALARM) run();
  });

  return {
    schedule: (delayMs) => {
      const now = dependencies.now?.() ?? Date.now();
      chromeApi.alarms.create(EFFECT_RETRY_ALARM, {
        when: now + Math.max(MIN_RETRY_DELAY_MS, delayMs),
      });
    },
    clear: () => {
      void Promise.resolve(chromeApi.alarms.clear(EFFECT_RETRY_ALARM)).catch(() => undefined);
    },
  };
}
