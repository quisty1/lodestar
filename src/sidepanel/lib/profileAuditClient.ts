import { isProfileAuditResult } from '@lib/profile/contracts';
import {
  RUNTIME_ERROR_CODES,
  WORKER_PROTOCOL_VERSION,
  runtimeError,
  type RuntimeErrorCode,
  type RuntimeFailure,
  type StartProfileAuditRequest,
  type StartProfileAuditResponse,
} from '@lib/runtimeProtocol';

const ERROR_CODES = new Set<string>(RUNTIME_ERROR_CODES);
const DEFAULT_WAKE_DELAYS = [0, 100, 300] as const;
const COMMAND_ATTEMPTS = 2;

type SendMessage = (message: unknown) => Promise<unknown>;
type CallResult = { ok: true; value: unknown } | { ok: false; failure: RuntimeFailure };

export interface ProfileAuditClientOptions {
  sendMessage?: SendMessage;
  wakeTimeoutMs?: number;
  timeoutMs?: number;
  wakeDelaysMs?: readonly number[];
}

export interface ProfileAuditClient {
  start(request: StartProfileAuditRequest): Promise<StartProfileAuditResponse>;
}

export function createProfileAuditClient(
  options: ProfileAuditClientOptions = {},
): ProfileAuditClient {
  const sendMessage = options.sendMessage ?? sendChromeMessage;
  const wakeTimeoutMs = options.wakeTimeoutMs ?? 1_500;
  const commandTimeoutMs = options.timeoutMs ?? 45_000;
  const wakeDelaysMs = options.wakeDelaysMs ?? DEFAULT_WAKE_DELAYS;

  return {
    async start(request) {
      const wakeFailure = await wakeWorker(sendMessage, wakeTimeoutMs, wakeDelaysMs);
      if (wakeFailure) return wakeFailure;

      let lastFailure = runtimeError('transport-error', 'Service worker unavailable', true);
      for (let attempt = 0; attempt < COMMAND_ATTEMPTS; attempt += 1) {
        const call = await callWithTimeout(sendMessage, request, commandTimeoutMs);
        if (!call.ok) {
          lastFailure = call.failure;
          continue;
        }
        return (
          parseResponse(call.value, request.requestId) ??
          runtimeError('protocol-error', 'Некорректный ответ аудита.', false)
        );
      }
      return lastFailure;
    },
  };
}

export const profileAuditClient = createProfileAuditClient();

async function wakeWorker(
  sendMessage: SendMessage,
  timeoutMs: number,
  delaysMs: readonly number[],
): Promise<RuntimeFailure | null> {
  let lastFailure = runtimeError('transport-error', 'Service worker unavailable', true);
  for (const delayMs of delaysMs) {
    if (delayMs > 0) await delay(delayMs);
    const call = await callWithTimeout(sendMessage, { type: 'PING' }, timeoutMs);
    if (!call.ok) {
      lastFailure = call.failure;
      continue;
    }
    if (
      !isRecord(call.value) ||
      call.value.type !== 'PONG' ||
      call.value.protocolVersion !== WORKER_PROTOCOL_VERSION
    ) {
      return runtimeError('protocol-error', 'Версии панели и расширения не совпадают.', false);
    }
    return null;
  }
  return lastFailure;
}

async function callWithTimeout(
  sendMessage: SendMessage,
  message: unknown,
  timeoutMs: number,
): Promise<CallResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CallResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        ok: false,
        failure: runtimeError('timeout', 'Service worker timed out', true),
      });
    }, timeoutMs);
  });
  const request = Promise.resolve()
    .then(() => sendMessage(message))
    .then(
      (value): CallResult => ({ ok: true, value }),
      (): CallResult => ({
        ok: false,
        failure: runtimeError('transport-error', 'Service worker unavailable', true),
      }),
    );
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function parseResponse(value: unknown, requestId: string): StartProfileAuditResponse | null {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return null;
  if (value.ok) {
    if (
      !isRecord(value.data) ||
      value.data.requestId !== requestId ||
      !isProfileAuditResult(value.data.result)
    )
      return null;
    return { ok: true, data: { requestId, result: value.data.result } };
  }
  if (!isRecord(value.error)) return null;
  const { code, message, retryable } = value.error;
  if (typeof code !== 'string' || !ERROR_CODES.has(code) || typeof message !== 'string')
    return null;
  if (retryable !== undefined && typeof retryable !== 'boolean') return null;
  return runtimeError(code as RuntimeErrorCode, message, retryable);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendChromeMessage(message: unknown): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id)
    throw new Error('Extension runtime unavailable');
  return chrome.runtime.sendMessage(message);
}
