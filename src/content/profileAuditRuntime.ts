import type { ProfileSnapshot } from '@lib/profile/contracts';

type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

export interface RuntimeMessageEvent {
  addListener(listener: RuntimeListener): void;
}

export interface ProfileAuditContentRuntimeDeps {
  read(): Promise<ProfileSnapshot | null>;
}

export function registerProfileAuditContentRuntime(
  event: RuntimeMessageEvent,
  deps: ProfileAuditContentRuntimeDeps,
): void {
  event.addListener((message, _sender, sendResponse) => {
    if (!isReadRequest(message)) return false;
    void deps.read().then(
      (snapshot) => {
        sendResponse(
          snapshot
            ? { ok: true, requestId: message.requestId, snapshot }
            : { ok: false, requestId: message.requestId, error: 'unsupported_dom' },
        );
      },
      () => {
        sendResponse({ ok: false, requestId: message.requestId, error: 'unsupported_dom' });
      },
    );
    return true;
  });
}

export async function waitForProfileSnapshot(
  read: () => ProfileSnapshot | null,
  wait: (ms: number) => Promise<void>,
  attempts = 20,
  intervalMs = 250,
): Promise<ProfileSnapshot | null> {
  const limit = Math.max(1, attempts);
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const snapshot = read();
    if (snapshot) return snapshot;
    if (attempt + 1 < limit) await wait(intervalMs);
  }
  return null;
}

function isReadRequest(value: unknown): value is { type: 'READ_PROFILE_AUDIT'; requestId: string } {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as { type?: unknown; requestId?: unknown };
  return (
    request.type === 'READ_PROFILE_AUDIT' &&
    typeof request.requestId === 'string' &&
    request.requestId.trim().length > 0
  );
}
