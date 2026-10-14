import type { GateDecision } from '@lib/autopilot/AutopilotGatekeeper';
import {
  WORKER_PROTOCOL_VERSION,
  runtimeError,
  type GetAutopilotStatusResponse,
  type StartAutopilotResponse,
  type StopAutopilotResponse,
} from '@lib/runtimeProtocol';
import type { RiskMarker } from '@lib/autopilot/RiskAssessor';
import { isEffectOutcome, sanitizeEffectDescriptor } from '@lib/autopilot/EffectLedger';
import type {
  CommitEffectResult,
  ReserveEffectResult,
  SettleEffectOptions,
  SettleEffectResult,
} from '@lib/autopilot/RunCoordinator';
import type {
  AutopilotHost,
  LodestarMessage,
  EffectDescriptor,
  EffectOutcome,
  StartAutopilotResult,
  StopReason,
} from '@lib/types';

type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

export interface RuntimeMessageEvent {
  addListener(listener: RuntimeListener): void;
}

export interface AutopilotRuntimeHandlers {
  status(): Promise<GetAutopilotStatusResponse>;
  start(host: AutopilotHost, requestId?: string): Promise<StartAutopilotResponse>;
  stop(runId?: string): Promise<StopAutopilotResponse>;
  mayAct(runId: string): Promise<GateDecision>;
  acted(runId: string, ok: boolean): Promise<boolean>;
  reserveEffect(
    runId: string,
    requestId: string,
    descriptor: EffectDescriptor,
    senderTabId: number,
  ): Promise<ReserveEffectResult>;
  commitEffect(
    runId: string,
    effectId: string,
    requestId: string,
    attemptId: string,
    senderTabId: number,
  ): Promise<CommitEffectResult>;
  settleEffect(
    runId: string,
    effectId: string,
    requestId: string,
    outcome: EffectOutcome,
    options: SettleEffectOptions,
    senderTabId: number,
  ): Promise<SettleEffectResult>;
  risk(runId: string, marker: RiskMarker): Promise<boolean>;
  ended(runId: string, reason: StopReason): Promise<boolean>;
}

export function registerAutopilotRuntime(
  event: RuntimeMessageEvent,
  handlers: AutopilotRuntimeHandlers,
): void {
  // A lost response makes the side panel resend the same idempotency key. Keep
  // the exact promise/result for this worker lifetime so a retry cannot observe
  // RunCoordinator's intermediate "duplicate" state as a false START success.
  const startRequests = new Map<string, Promise<StartAutopilotResponse>>();
  event.addListener((raw, sender, sendResponse) => {
    if (!isRecord(raw) || typeof raw.type !== 'string') return false;
    const message = raw as LodestarMessage;
    switch (message.type) {
      case 'PING':
        sendResponse({ type: 'PONG', protocolVersion: WORKER_PROTOCOL_VERSION });
        return false;
      case 'GET_AUTOPILOT_STATUS':
        void safe(() => handlers.status()).then(sendResponse);
        return true;
      case 'START_AUTOPILOT':
        if (message.requestId === undefined) {
          void safe(() => handlers.start(message.host)).then((result) => {
            sendResponse(legacyStart(result));
          });
          return true;
        }
        {
          let result = startRequests.get(message.requestId);
          if (!result) {
            result = safe(() => handlers.start(message.host, message.requestId));
            startRequests.set(message.requestId, result);
          }
          void result.then(sendResponse);
        }
        return true;
      case 'STOP_AUTOPILOT':
        void safe(() => handlers.stop(message.runId)).then((result) => {
          sendResponse(message.runId === undefined ? { ok: result.ok } : result);
        });
        return true;
      case 'AUTOPILOT_MAY_ACT':
        void handlers.mayAct(message.runId).then(sendResponse, () => {
          sendResponse({ action: 'stop', reason: 'error' });
        });
        return true;
      case 'AUTOPILOT_ACTED':
        void handlers.acted(message.runId, message.ok).then(
          (ok) => {
            sendResponse({ ok });
          },
          () => {
            sendResponse({ ok: false });
          },
        );
        return true;
      case 'AUTOPILOT_RESERVE_EFFECT': {
        const descriptor = sanitizeEffectDescriptor(message.descriptor);
        const tabId = senderTabId(sender);
        if (!validIdentity(message.runId, message.requestId) || !descriptor || tabId === null) {
          sendResponse({ kind: 'invalid', canExecute: false });
          return false;
        }
        void handlers
          .reserveEffect(message.runId, message.requestId, descriptor, tabId)
          .then(sendResponse, () => {
            sendResponse({ kind: 'inactive', canExecute: false });
          });
        return true;
      }
      case 'AUTOPILOT_COMMIT_EFFECT': {
        const tabId = senderTabId(sender);
        if (
          !validIdentity(message.runId, message.effectId, message.requestId, message.attemptId) ||
          tabId === null
        ) {
          sendResponse({ kind: 'rejected', admitted: false, reason: 'identity' });
          return false;
        }
        void handlers
          .commitEffect(
            message.runId,
            message.effectId,
            message.requestId,
            message.attemptId,
            tabId,
          )
          .then(sendResponse, () => {
            sendResponse({ kind: 'rejected', admitted: false, reason: 'inactive' });
          });
        return true;
      }
      case 'AUTOPILOT_SETTLE_EFFECT': {
        const tabId = senderTabId(sender);
        if (
          !validIdentity(message.runId, message.effectId, message.requestId) ||
          (message.attemptId !== undefined && !validIdentity(message.attemptId)) ||
          !isEffectOutcome(message.outcome) ||
          (message.reason !== undefined && typeof message.reason !== 'string') ||
          tabId === null
        ) {
          sendResponse({ kind: 'rejected', reason: 'identity' });
          return false;
        }
        void handlers
          .settleEffect(
            message.runId,
            message.effectId,
            message.requestId,
            message.outcome,
            { attemptId: message.attemptId, reason: message.reason },
            tabId,
          )
          .then(sendResponse, () => {
            sendResponse({ kind: 'rejected', reason: 'inactive' });
          });
        return true;
      }
      case 'AUTOPILOT_RISK':
        void handlers.risk(message.runId, message.marker).then(
          (ok) => {
            sendResponse({ ok });
          },
          () => {
            sendResponse({ ok: false });
          },
        );
        return true;
      case 'AUTOPILOT_ENDED':
        void handlers.ended(message.runId, message.reason).then(
          (ok) => {
            sendResponse({ ok });
          },
          () => {
            sendResponse({ ok: false });
          },
        );
        return true;
      default:
        return false;
    }
  });
}

async function safe<
  T extends GetAutopilotStatusResponse | StartAutopilotResponse | StopAutopilotResponse,
>(operation: () => Promise<T>): Promise<T | ReturnType<typeof runtimeError>> {
  try {
    return await operation();
  } catch {
    return runtimeError('internal-error', 'Autopilot runtime failed', true);
  }
}

function legacyStart(
  result: StartAutopilotResponse | ReturnType<typeof runtimeError>,
): StartAutopilotResult {
  if (result.ok) {
    return {
      started: true,
      runId: result.data.runId,
      status: result.data.status,
      duplicate: result.data.duplicate,
    };
  }
  return { started: false, reason: legacyReason(result.error.code) };
}

function legacyReason(code: string): NonNullable<StartAutopilotResult['reason']> {
  switch (code) {
    case 'no-modules':
      return 'no-modules';
    case 'paused':
      return 'paused';
    case 'already-running':
      return 'already-running';
    case 'recovery-required':
      return 'recovery-required';
    case 'no-linkedin-tab':
      return 'no-linkedin-tab';
    case 'missing-host-permission':
      return 'missing-host-permission';
    case 'navigation-failed':
      return 'navigation-failed';
    case 'unsupported-dom':
      return 'unsupported-dom';
    default:
      return 'internal-error';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function senderTabId(sender: unknown): number | null {
  if (!isRecord(sender) || !isRecord(sender.tab)) return null;
  return typeof sender.tab.id === 'number' && Number.isInteger(sender.tab.id)
    ? sender.tab.id
    : null;
}

function validIdentity(...values: unknown[]): boolean {
  return values.every((value) => typeof value === 'string' && value.trim().length > 0);
}
