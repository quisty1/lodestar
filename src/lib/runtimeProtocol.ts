import type { AutopilotHost, AutopilotStatus } from './types';
import type { ProfileAuditResult, ProfileSnapshot } from './profile/contracts';

export const CONTENT_PROTOCOL_VERSION = 6;
/** Side panel ↔ extension service worker contract. Bump on incompatible envelopes. */
export const WORKER_PROTOCOL_VERSION = 3;

export const RUNTIME_ERROR_CODES = [
  'no-modules',
  'paused',
  'already-running',
  'recovery-required',
  'stale-run',
  'no-linkedin-tab',
  'missing-host-permission',
  'navigation-failed',
  'unsupported-dom',
  'transport-error',
  'timeout',
  'protocol-error',
  'not-authenticated',
  'internal-error',
] as const;

export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

export interface RuntimeFailure {
  ok: false;
  error: {
    code: RuntimeErrorCode;
    message: string;
    retryable?: boolean;
  };
}

export type RuntimeResult<T> = { ok: true; data: T } | RuntimeFailure;

export interface GetAutopilotStatusRequest {
  type: 'GET_AUTOPILOT_STATUS';
}

export interface StartAutopilotRequest {
  type: 'START_AUTOPILOT';
  host: AutopilotHost;
  requestId: string;
}

export interface StopAutopilotRequest {
  type: 'STOP_AUTOPILOT';
  runId: string;
}

export type AutopilotRuntimeRequest =
  GetAutopilotStatusRequest | StartAutopilotRequest | StopAutopilotRequest;

export type GetAutopilotStatusResponse = RuntimeResult<AutopilotStatus>;

export interface StartAutopilotData {
  started: true;
  duplicate: boolean;
  runId: string;
  status: AutopilotStatus;
}

export type StartAutopilotResponse = RuntimeResult<StartAutopilotData>;

export interface StopAutopilotData {
  stopped: boolean;
  runId: string;
  status: AutopilotStatus;
}

export type StopAutopilotResponse = RuntimeResult<StopAutopilotData>;

export interface StartProfileAuditRequest {
  type: 'START_PROFILE_AUDIT';
  requestId: string;
}

export interface ReadProfileAuditRequest {
  type: 'READ_PROFILE_AUDIT';
  requestId: string;
}

export type ReadProfileAuditResponse =
  | { ok: true; requestId: string; snapshot: ProfileSnapshot }
  | { ok: false; requestId: string; error: 'unsupported_dom' };

export interface StartProfileAuditData {
  requestId: string;
  result: ProfileAuditResult;
}

export type StartProfileAuditResponse = RuntimeResult<StartProfileAuditData>;

export interface WorkerPong {
  type: 'PONG';
  protocolVersion: number;
}

export function runtimeOk<T>(data: T): RuntimeResult<T> {
  return { ok: true, data };
}

export function runtimeError(
  code: RuntimeErrorCode,
  message: string,
  retryable?: boolean,
): RuntimeFailure {
  return {
    ok: false,
    error: retryable === undefined ? { code, message } : { code, message, retryable },
  };
}
