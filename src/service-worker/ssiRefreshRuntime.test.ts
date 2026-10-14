import { describe, expect, it, vi } from 'vitest';
import type { ProfileViewsSnapshot, SsiSnapshot } from '@lib/types';
import type { RefreshResult } from '@lib/refresh/BackgroundRefreshService';
import { registerSsiRefreshRuntime } from './ssiRefreshRuntime';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

const ssi: SsiSnapshot = {
  total: 63,
  pillars: [
    { key: 'brand', label: 'Бренд', score: 15 },
    { key: 'people', label: 'Люди', score: 16 },
    { key: 'insights', label: 'Контент', score: 17 },
    { key: 'relationships', label: 'Отношения', score: 15 },
  ],
  capturedAt: '2026-08-11T10:00:00.000Z',
};

const views: ProfileViewsSnapshot = {
  count: 42,
  windowDays: 90,
  capturedAt: '2026-08-11T10:00:00.000Z',
};

function setup(ssiResult: RefreshResult = { status: 'refreshed', snapshot: ssi }) {
  let listener: Listener | undefined;
  const deps = {
    refreshSsi: vi.fn(async () => ssiResult),
    saveSsi: vi.fn(async () => undefined),
    broadcastSsi: vi.fn(),
    refreshProfileViews: vi.fn(async (): Promise<RefreshResult<ProfileViewsSnapshot>> => ({
      status: 'refreshed',
      snapshot: views,
    })),
    saveProfileViews: vi.fn(async () => undefined),
    broadcastProfileViews: vi.fn(),
    onError: vi.fn(),
  };
  registerSsiRefreshRuntime(
    {
      addListener: (next) => {
        listener = next;
      },
    },
    deps,
  );
  return { listener: listener!, deps };
}

describe('registered SSI refresh runtime boundary', () => {
  it.each<RefreshResult>([
    { status: 'refreshed', snapshot: ssi },
    { status: 'error', error: 'network' },
    { status: 'busy' },
  ])('responds exactly once with $status', async (result) => {
    const { listener } = setup(result);
    const sendResponse = vi.fn();

    expect(listener({ type: 'FORCE_REFRESH' }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledOnce();
    });
    expect(sendResponse).toHaveBeenCalledWith(result);
  });

  it('persists and broadcasts only refreshed snapshots', async () => {
    const refreshed = setup();
    refreshed.listener({ type: 'FORCE_REFRESH' }, {}, vi.fn());
    await vi.waitFor(() => {
      expect(refreshed.deps.saveSsi).toHaveBeenCalledWith(ssi);
    });
    expect(refreshed.deps.broadcastSsi).toHaveBeenCalledWith(ssi);

    const failed = setup({ status: 'error', error: 'bad response' });
    failed.listener({ type: 'FORCE_REFRESH' }, {}, vi.fn());
    await vi.waitFor(() => {
      expect(failed.deps.refreshSsi).toHaveBeenCalledOnce();
    });
    expect(failed.deps.saveSsi).not.toHaveBeenCalled();
    expect(failed.deps.broadcastSsi).not.toHaveBeenCalled();
  });

  it('keeps profile views independent and turns SSI exceptions into an error response', async () => {
    const { listener, deps } = setup();
    deps.refreshSsi.mockRejectedValueOnce(new Error('offline'));
    deps.refreshProfileViews.mockRejectedValueOnce(new Error('wvmp offline'));
    const sendResponse = vi.fn();

    listener({ type: 'FORCE_REFRESH' }, {}, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledOnce();
    });
    expect(sendResponse).toHaveBeenCalledWith({ status: 'error', error: 'offline' });
    expect(deps.refreshProfileViews).toHaveBeenCalledOnce();
    expect(deps.onError).toHaveBeenCalledWith('profile-views', expect.any(Error));
  });

  it('ignores unrelated runtime messages', () => {
    const { listener, deps } = setup();
    const sendResponse = vi.fn();

    expect(listener({ type: 'PING' }, {}, sendResponse)).toBe(false);
    expect(deps.refreshSsi).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
