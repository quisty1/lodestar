import { describe, expect, it, vi } from 'vitest';
import type { ProfileSnapshot } from '@lib/profile/contracts';
import { registerProfileAuditContentRuntime, waitForProfileSnapshot } from './profileAuditRuntime';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

const snapshot = { capturedAt: '2026-08-15T12:00:00.000Z' } as ProfileSnapshot;

function capture(read: () => Promise<ProfileSnapshot | null>) {
  let listener: Listener | undefined;
  registerProfileAuditContentRuntime(
    {
      addListener: (next) => {
        listener = next;
      },
    },
    { read },
  );
  return listener!;
}

describe('registerProfileAuditContentRuntime', () => {
  it('waits for bounded client-side profile hydration', async () => {
    const read = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValue(snapshot);
    const wait = vi.fn(async () => undefined);

    expect(await waitForProfileSnapshot(read, wait, 4, 25)).toBe(snapshot);
    expect(read).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('returns one request-scoped snapshot through the real listener boundary', async () => {
    const listener = capture(async () => snapshot);
    const sendResponse = vi.fn();

    expect(listener({ type: 'READ_PROFILE_AUDIT', requestId: 'request-1' }, {}, sendResponse)).toBe(
      true,
    );
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, requestId: 'request-1', snapshot });
    });
  });

  it('fails closed when the DOM is unsupported', async () => {
    const listener = capture(async () => null);
    const sendResponse = vi.fn();

    expect(listener({ type: 'READ_PROFILE_AUDIT', requestId: 'request-1' }, {}, sendResponse)).toBe(
      true,
    );
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        requestId: 'request-1',
        error: 'unsupported_dom',
      });
    });
  });

  it('rejects malformed requests without reading the page', () => {
    const read = vi.fn(async () => snapshot);
    const listener = capture(read);
    const sendResponse = vi.fn();

    expect(listener({ type: 'READ_PROFILE_AUDIT', requestId: '' }, {}, sendResponse)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
