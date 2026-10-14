import { auditProfile } from '@lib/profile/auditProfile';
import { isProfileSnapshot, type ProfileAuditResult } from '@lib/profile/contracts';
import { runtimeError, runtimeOk, type StartProfileAuditResponse } from '@lib/runtimeProtocol';
import type { ProfileAuditTargetResult } from './profileAuditTarget';

type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

export interface RuntimeMessageEvent {
  addListener(listener: RuntimeListener): void;
}

export interface ProfileAuditRuntimeDeps {
  prepare(): Promise<ProfileAuditTargetResult>;
  read(tabId: number, requestId: string): Promise<unknown>;
  save(result: ProfileAuditResult): Promise<void>;
  now(): Date;
}

export interface ProfileAuditRuntimeHandlers {
  start(requestId: string): Promise<StartProfileAuditResponse>;
}

export function registerProfileAuditRuntime(
  event: RuntimeMessageEvent,
  handlers: ProfileAuditRuntimeHandlers,
): void {
  const requests = new Map<string, Promise<StartProfileAuditResponse>>();
  event.addListener((message, _sender, sendResponse) => {
    if (!isStartRequest(message)) return false;
    let response = requests.get(message.requestId);
    if (!response) {
      response = handlers
        .start(message.requestId)
        .catch(() => runtimeError('internal-error', 'Не удалось выполнить аудит.', true));
      requests.set(message.requestId, response);
    }
    void response.then(sendResponse);
    return true;
  });
}

export async function runProfileAudit(
  requestId: string,
  deps: ProfileAuditRuntimeDeps,
): Promise<StartProfileAuditResponse> {
  const prepared = await deps
    .prepare()
    .catch(() => ({ ok: false as const, reason: 'navigation-failed' as const }));
  if (!prepared.ok) return targetFailure(prepared.reason);

  let raw: unknown;
  try {
    raw = await deps.read(prepared.tabId, requestId);
  } catch {
    return runtimeError('transport-error', 'Страница LinkedIn не ответила.', true);
  }
  if (isReadFailure(raw, requestId)) {
    return runtimeError('unsupported-dom', 'Не удалось прочитать профиль LinkedIn.', true);
  }
  if (!isReadSuccess(raw, requestId)) {
    return runtimeError('protocol-error', 'Некорректный ответ страницы LinkedIn.', false);
  }

  const result = auditProfile(raw.snapshot, deps.now().toISOString());
  try {
    await deps.save(result);
  } catch {
    return runtimeError('internal-error', 'Не удалось сохранить результат аудита.', true);
  }
  return runtimeOk({ requestId, result });
}

function targetFailure(
  reason: Exclude<ProfileAuditTargetResult, { ok: true }>['reason'],
): StartProfileAuditResponse {
  switch (reason) {
    case 'missing-host-permission':
      return runtimeError('missing-host-permission', 'Разреши доступ к www.linkedin.com.', true);
    case 'no-linkedin-tab':
      return runtimeError('no-linkedin-tab', 'Открой LinkedIn в активной вкладке.', true);
    case 'navigation-failed':
      return runtimeError('navigation-failed', 'Не удалось открыть собственный профиль.', true);
    case 'not-authenticated':
      return runtimeError('not-authenticated', 'Авторизуйся в LinkedIn и повтори.', true);
    case 'unsupported-dom':
      return runtimeError('unsupported-dom', 'LinkedIn изменил разметку профиля.', true);
  }
}

function isStartRequest(
  value: unknown,
): value is { type: 'START_PROFILE_AUDIT'; requestId: string } {
  if (!isRecord(value)) return false;
  return value.type === 'START_PROFILE_AUDIT' && nonEmpty(value.requestId);
}

function isReadSuccess(
  value: unknown,
  requestId: string,
): value is {
  ok: true;
  requestId: string;
  snapshot: import('@lib/profile/contracts').ProfileSnapshot;
} {
  return (
    isRecord(value) &&
    value.ok === true &&
    value.requestId === requestId &&
    isProfileSnapshot(value.snapshot)
  );
}

function isReadFailure(value: unknown, requestId: string): boolean {
  return (
    isRecord(value) &&
    value.ok === false &&
    value.requestId === requestId &&
    value.error === 'unsupported_dom'
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
