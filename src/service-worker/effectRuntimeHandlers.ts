import type { EffectService } from '@lib/autopilot/EffectService';
import { isScopedAutopilotState, type RunCoordinator } from '@lib/autopilot/RunCoordinator';
import type { AutopilotRuntimeHandlers } from './autopilotRuntime';

type EffectRuntimeHandlers = Pick<
  AutopilotRuntimeHandlers,
  'acted' | 'reserveEffect' | 'commitEffect' | 'settleEffect'
>;

/** Storage-led, sender-fenced production bridge from runtime messages to the effect ledger. */
export function createEffectRuntimeHandlers(dependencies: {
  coordinator: RunCoordinator;
  effects: EffectService;
  onSettled?(runId: string): void;
}): EffectRuntimeHandlers {
  const ownsTab = async (runId: string, tabId: number): Promise<boolean> => {
    const state = await dependencies.coordinator.getState();
    return isScopedAutopilotState(state) && state.runId === runId && state.tabId === tabId;
  };

  return {
    // Ledger receipts are the only write path for new runs. Reject the legacy
    // increment message so a delayed content script cannot double-spend likes.
    acted: () => Promise.resolve(false),
    reserveEffect: async (runId, requestId, descriptor, tabId) => {
      if (!(await ownsTab(runId, tabId))) return { kind: 'inactive', canExecute: false };
      return dependencies.coordinator.reserveEffect(runId, requestId, descriptor);
    },
    commitEffect: async (runId, effectId, requestId, attemptId, tabId) => {
      if (!(await ownsTab(runId, tabId))) {
        return { kind: 'rejected', admitted: false, reason: 'inactive' };
      }
      return dependencies.coordinator.commitEffect(runId, effectId, requestId, attemptId);
    },
    settleEffect: async (runId, effectId, requestId, outcome, options, tabId) => {
      if (!(await ownsTab(runId, tabId))) return { kind: 'rejected', reason: 'inactive' };
      const result = await dependencies.effects.settle(
        runId,
        effectId,
        requestId,
        outcome,
        options,
      );
      if (result.kind !== 'rejected') dependencies.onSettled?.(runId);
      return result;
    },
  };
}
