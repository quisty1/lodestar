import {
  WORKER_PROTOCOL_VERSION,
  RUNTIME_ERROR_CODES,
  runtimeError,
  type AutopilotRuntimeRequest,
  type GetAutopilotStatusRequest,
  type GetAutopilotStatusResponse,
  type RuntimeErrorCode,
  type RuntimeFailure,
  type RuntimeResult,
  type StartAutopilotRequest,
  type StartAutopilotResponse,
  type StopAutopilotRequest,
  type StopAutopilotResponse,
} from '@lib/runtimeProtocol';
import { RUN_PHASES, STOP_REASONS, type AutopilotStatus } from '@lib/types';

const WAKE_DELAYS_MS = [0, 100, 300] as const;
const COMMAND_ATTEMPTS = 2;
const DEFAULT_TIMEOUTS = {
  wake: 1_500,
  status: 3_000,
  // prepareFeedTarget can legitimately spend 30s in bounded load/content polling.
  start: 60_000,
  stop: 5_000,
} as const;

const RUNTIME_ERROR_CODE_SET = new Set<string>(RUNTIME_ERROR_CODES);
const RUN_PHASE_SET = new Set<string>(RUN_PHASES);
const ACTIVE_RUN_PHASE_SET = new Set<string>(
  RUN_PHASES.filter(
    (phase) => phase !== 'stopping' && phase !== 'finalizing' && phase !== 'finished',
  ),
);
const RECOVERY_RUN_PHASE_SET = new Set<string>(['stopping', 'finalizing']);
const STOP_REASON_SET = new Set<string>(STOP_REASONS);

type SendMessage = (message: unknown) => Promise<unknown>;

export interface RuntimeClientOptions {
  sendMessage?: SendMessage;
  /** Test/backward-compatible override for every request category. */
  timeoutMs?: number;
  timeouts?: Partial<RuntimeTimeouts>;
  wakeDelaysMs?: readonly number[];
}

export interface RuntimeTimeouts {
  wake: number;
  status: number;
  start: number;
  stop: number;
}

export interface AutopilotRuntimeClient {
  status(request?: GetAutopilotStatusRequest): Promise<GetAutopilotStatusResponse>;
  start(request: StartAutopilotRequest): Promise<StartAutopilotResponse>;
  stop(request: StopAutopilotRequest): Promise<StopAutopilotResponse>;
}

type CallResult = { ok: true; value: unknown } | { ok: false; failure: RuntimeFailure };

export function createRuntimeClient(options: RuntimeClientOptions = {}): AutopilotRuntimeClient {
  const sendMessage = options.sendMessage ?? sendChromeMessage;
  const timeouts: RuntimeTimeouts =
    options.timeoutMs === undefined
      ? { ...DEFAULT_TIMEOUTS, ...options.timeouts }
      : {
          wake: options.timeoutMs,
          status: options.timeoutMs,
          start: options.timeoutMs,
          stop: options.timeoutMs,
        };
  const wakeDelaysMs = options.wakeDelaysMs ?? WAKE_DELAYS_MS;

  const execute = async <T>(
    request: AutopilotRuntimeRequest,
    validateData: (value: unknown) => value is T,
    commandTimeoutMs: number,
  ): Promise<RuntimeResult<T>> => {
    const wakeFailure = await wakeWorker(sendMessage, timeouts.wake, wakeDelaysMs);
    if (wakeFailure) return wakeFailure;

    let lastFailure: RuntimeFailure = runtimeError(
      'transport-error',
      'Service worker unavailable',
      true,
    );
    for (let attempt = 0; attempt < COMMAND_ATTEMPTS; attempt += 1) {
      const call = await callWithTimeout(sendMessage, request, commandTimeoutMs);
      if (!call.ok) {
        lastFailure = call.failure;
        continue;
      }

      const result = parseRuntimeResult(call.value, validateData);
      return result ?? runtimeError('protocol-error', 'Некорректный ответ расширения.', false);
    }
    return lastFailure;
  };

  return {
    status: (request = { type: 'GET_AUTOPILOT_STATUS' }) =>
      execute(request, isAutopilotStatus, timeouts.status),
    start: (request) => execute(request, isStartData, timeouts.start),
    stop: (request) => execute(request, isStopData, timeouts.stop),
  };
}

export const runtimeClient = createRuntimeClient();

async function wakeWorker(
  sendMessage: SendMessage,
  timeoutMs: number,
  delaysMs: readonly number[],
): Promise<RuntimeFailure | null> {
  let lastFailure: RuntimeFailure = runtimeError(
    'transport-error',
    'Service worker unavailable',
    true,
  );
  for (const delayMs of delaysMs) {
    if (delayMs > 0) await delay(delayMs);
    const call = await callWithTimeout(sendMessage, { type: 'PING' }, timeoutMs);
    if (!call.ok) {
      lastFailure = call.failure;
      continue;
    }
    if (!isWorkerPong(call.value)) {
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
      resolve({ ok: false, failure: runtimeError('timeout', 'Service worker timed out', true) });
    }, timeoutMs);
  });
  const request: Promise<CallResult> = Promise.resolve()
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

function parseRuntimeResult<T>(
  value: unknown,
  validateData: (value: unknown) => value is T,
): RuntimeResult<T> | null {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return null;
  if (value.ok) return validateData(value.data) ? { ok: true, data: value.data } : null;
  if (!isRecord(value.error)) return null;
  const { code, message, retryable } = value.error;
  if (typeof code !== 'string' || !RUNTIME_ERROR_CODE_SET.has(code)) return null;
  if (typeof message !== 'string' || (retryable !== undefined && typeof retryable !== 'boolean'))
    return null;
  return runtimeError(code as RuntimeErrorCode, message, retryable);
}

function isWorkerPong(value: unknown): boolean {
  return (
    isRecord(value) && value.type === 'PONG' && value.protocolVersion === WORKER_PROTOCOL_VERSION
  );
}

function isAutopilotStatus(value: unknown): value is AutopilotStatus {
  if (!(
    isRecord(value) &&
    typeof value.running === 'boolean' &&
    typeof value.used === 'number' &&
    Number.isFinite(value.used) &&
    typeof value.ceiling === 'number' &&
    Number.isFinite(value.ceiling) &&
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 0 &&
    optionalNonEmptyString(value.runId) &&
    (!value.running || nonEmptyString(value.runId)) &&
    optionalMember(value.phase, RUN_PHASE_SET) &&
    optionalString(value.stage) &&
    optionalString(value.expectedUrl) &&
    optionalMember(value.stopReason, STOP_REASON_SET) &&
    optionalString(value.startedAt) &&
    optionalString(value.endedAt) &&
    (value.recoveryRequired === undefined || typeof value.recoveryRequired === 'boolean')
  )) {
    return false;
  }

  return hasConsistentRunLifecycle(value);
}

function hasConsistentRunLifecycle(value: Record<string, unknown>): boolean {
  const hasRunId = value.runId !== undefined;
  const hasPhase = value.phase !== undefined;
  const recoveryRequired = value.recoveryRequired === true;

  if (!hasRunId || !hasPhase) {
    return !hasRunId && !hasPhase && value.running === false;
  }

  const phase = value.phase as string;
  if (value.running === true) {
    return ACTIVE_RUN_PHASE_SET.has(phase) && !recoveryRequired;
  }
  if (RECOVERY_RUN_PHASE_SET.has(phase)) return recoveryRequired;
  return phase === 'finished' && !recoveryRequired;
}

function isStartData(
  value: unknown,
): value is StartAutopilotResponse extends RuntimeResult<infer T> ? T : never {
  return (
    isRecord(value) &&
    value.started === true &&
    typeof value.duplicate === 'boolean' &&
    nonEmptyString(value.runId) &&
    isAutopilotStatus(value.status) &&
    value.status.running &&
    value.status.runId === value.runId
  );
}

function isStopData(
  value: unknown,
): value is StopAutopilotResponse extends RuntimeResult<infer T> ? T : never {
  return (
    isRecord(value) &&
    typeof value.stopped === 'boolean' &&
    nonEmptyString(value.runId) &&
    isAutopilotStatus(value.status) &&
    value.status.runId === value.runId
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalNonEmptyString(value: unknown): boolean {
  return value === undefined || nonEmptyString(value);
}

function optionalMember(value: unknown, members: ReadonlySet<string>): boolean {
  return value === undefined || (typeof value === 'string' && members.has(value));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendChromeMessage(message: unknown): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    throw new Error('Extension runtime unavailable');
  }
  return chrome.runtime.sendMessage(message);
}
