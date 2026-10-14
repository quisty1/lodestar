import type { ModuleState, AutopilotState, StartAutopilotResult } from '../types';
import { asArray } from '../engagement/settings';

/**
 * Modules the one-button run should act on: enabled AND shipped (available).
 * «Скоро» modules (available:false) never count even if their toggle is on.
 * Guards the chrome.storage array-as-object gotcha via asArray.
 */
export function enabledModules(modulesState: unknown): ModuleState[] {
  return asArray<ModuleState>(modulesState).filter((m) => m?.enabled && m?.available);
}

/** Which runnable modules the loop should drive — flags for the content loop. */
export function runLoopModules(modulesState: unknown): { engagement: boolean; content: boolean } {
  const ids = new Set(enabledModules(modulesState).map((m) => m.id));
  return { engagement: ids.has('engagement'), content: ids.has('content') };
}

/**
 * Should the autopilot start? Pure decision off the persisted modules roster so
 * the SW side-effects stay off a tested core (the START_AUTOPILOT boundary).
 * No enabled+available module → blocked with a hint ("одна кнопка крутит ВКЛЮЧЁННЫЕ
 * модули"); an already-running pilot is reported started (idempotent).
 */
export function decideAutopilotStart(
  modulesState: unknown,
  existing: AutopilotState | null,
): StartAutopilotResult {
  if (existing?.running) return { started: true };
  if (enabledModules(modulesState).length === 0) return { started: false, reason: 'no-modules' };
  return { started: true };
}
