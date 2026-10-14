import type { ActionRequest, LodestarMessage, EffectExecutionToken } from '@lib/types';
import { sanitizeEffectDescriptor, sanitizeEffectId } from '@lib/autopilot/EffectLedger';
import type { ContentRunSession } from './runSession';

type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

export interface ScopedContentActionEvent {
  addListener(listener: RuntimeListener): void;
}

export interface ScopedContentActionDependencies {
  session: ContentRunSession;
  currentUrl(): string;
  acceptIncoming(
    runId: string,
    cap: number,
    shouldAbort: () => boolean,
  ): Promise<{ accepted: number }>;
  executeAction(
    action: ActionRequest,
    shouldAbort: () => boolean,
    effect: EffectExecutionToken,
  ): Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string };
  dwell(shouldAbort: () => boolean): Promise<{ ok: boolean; reason?: string }>;
  sleep(ms: number, shouldAbort: () => boolean): Promise<void>;
}

/** Owns every worker-driven content side effect so run identity is checked at one boundary. */
export function registerScopedContentActionRuntime(
  event: ScopedContentActionEvent,
  dependencies: ScopedContentActionDependencies,
): void {
  event.addListener((raw, _sender, sendResponse) => {
    if (!isRecord(raw) || typeof raw.type !== 'string') return false;
    const message = raw as LodestarMessage;
    if (!isScopedActionMessage(message)) return false;

    void dispatchScopedAction(message, dependencies).then(sendResponse, () => {
      sendResponse({ ok: false, reason: 'action-failed' });
    });
    return true;
  });
}

async function dispatchScopedAction(
  message: ScopedActionMessage,
  dependencies: ScopedContentActionDependencies,
): Promise<unknown> {
  const runId = message.runId;
  if (typeof runId !== 'string' || runId.length === 0) return cancelledResponse();
  const afterCommit = message.type === 'DWELL_PROFILE' && message.committed === true;
  const cancelled = () => !afterCommit && !dependencies.session.isActive(runId);
  if (cancelled()) return cancelledResponse();

  switch (message.type) {
    case 'SLEEP':
      await dependencies.sleep(message.ms, cancelled);
      return cancelled() ? cancelledResponse() : { ok: true, cancelled: false };

    case 'DWELL_PROFILE':
      if (message.expectedUrl && !sameRoute(dependencies.currentUrl(), message.expectedUrl)) {
        return { ok: false, reason: 'wrong-page' };
      }
      {
        return dependencies.dwell(cancelled);
      }

    case 'ACCEPT_INCOMING':
      return dependencies.acceptIncoming(runId, message.cap, cancelled);

    case 'EXECUTE_ACTION': {
      if (!isEffectToken(message.effect)) return { ok: false, reason: 'effect_required' };
      if (message.effect.runId !== runId) return cancelledResponse();
      return dependencies.executeAction(message.action, cancelled, message.effect);
    }
  }
}

type ScopedActionMessage = Extract<
  LodestarMessage,
  { type: 'SLEEP' | 'DWELL_PROFILE' | 'ACCEPT_INCOMING' | 'EXECUTE_ACTION' }
>;

function isScopedActionMessage(message: LodestarMessage): message is ScopedActionMessage {
  return (
    message.type === 'SLEEP' ||
    message.type === 'DWELL_PROFILE' ||
    message.type === 'ACCEPT_INCOMING' ||
    message.type === 'EXECUTE_ACTION'
  );
}

function cancelledResponse() {
  return { ok: false, cancelled: true, reason: 'run-inactive' as const };
}

function sameRoute(actual: string, expected: string): boolean {
  try {
    const normalize = (value: string) => {
      const parsed = new URL(value);
      return `${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/+$/, '') || '/'}`;
    };
    return normalize(actual) === normalize(expected);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEffectToken(value: unknown): value is EffectExecutionToken {
  return (
    isRecord(value) &&
    nonEmpty(value.runId) &&
    nonEmpty(value.requestId) &&
    sanitizeEffectId(value.effectId) === value.effectId &&
    sanitizeEffectDescriptor(value.descriptor) !== null
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
