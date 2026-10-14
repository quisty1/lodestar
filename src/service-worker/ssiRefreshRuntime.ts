import type { RefreshResult } from '@lib/refresh/BackgroundRefreshService';
import type { ProfileViewsSnapshot, SsiSnapshot } from '@lib/types';

type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

export interface RuntimeMessageEvent {
  addListener(listener: RuntimeListener): void;
}

export interface SsiRefreshRuntimeDeps {
  refreshSsi(): Promise<RefreshResult>;
  saveSsi(snapshot: SsiSnapshot): Promise<void>;
  broadcastSsi(snapshot: SsiSnapshot): void;
  refreshProfileViews(): Promise<RefreshResult<ProfileViewsSnapshot>>;
  saveProfileViews(snapshot: ProfileViewsSnapshot): Promise<void>;
  broadcastProfileViews(snapshot: ProfileViewsSnapshot): void;
  onError(scope: 'ssi' | 'profile-views', error: unknown): void;
}

/** Manual refresh is a request/response contract; profile views stays independent. */
export function registerSsiRefreshRuntime(
  event: RuntimeMessageEvent,
  deps: SsiRefreshRuntimeDeps,
): void {
  event.addListener((message, _sender, sendResponse) => {
    if (!isForceRefresh(message)) return false;

    void refreshMetric(
      () => deps.refreshSsi(),
      (snapshot) => deps.saveSsi(snapshot),
      (snapshot) => {
        deps.broadcastSsi(snapshot);
      },
      (error) => {
        deps.onError('ssi', error);
      },
    ).then(sendResponse);

    void refreshMetric(
      () => deps.refreshProfileViews(),
      (snapshot) => deps.saveProfileViews(snapshot),
      (snapshot) => {
        deps.broadcastProfileViews(snapshot);
      },
      (error) => {
        deps.onError('profile-views', error);
      },
    );

    return true;
  });
}

export async function refreshMetric<T extends { capturedAt: string }>(
  refresh: () => Promise<RefreshResult<T>>,
  save: (snapshot: T) => Promise<void>,
  broadcast: (snapshot: T) => void,
  onError: (error: unknown) => void = () => undefined,
): Promise<RefreshResult<T>> {
  try {
    const result = await refresh();
    if (result.status === 'refreshed') {
      await save(result.snapshot);
      broadcast(result.snapshot);
    }
    return result;
  } catch (error) {
    onError(error);
    return { status: 'error', error: errorMessage(error) };
  }
}

function isForceRefresh(value: unknown): value is { type: 'FORCE_REFRESH' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'FORCE_REFRESH'
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
