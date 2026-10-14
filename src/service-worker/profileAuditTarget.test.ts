import { describe, expect, it, vi } from 'vitest';
import { contentPong } from './contentPong.test-fixture';
import {
  LINKEDIN_PROFILE_ME_URL,
  prepareProfileAuditTarget,
  type ProfileAuditTargetDependencies,
  type ProfileAuditTab,
} from './profileAuditTarget';

const OWN_URL = 'https://www.linkedin.com/in/example/?isSelfProfile=true';

function tab(
  url: string,
  status: ProfileAuditTab['status'] = 'complete',
): ProfileAuditTab & { id: number } {
  return { id: 7, url, status, active: true, windowId: 1 };
}

function dependencies(
  overrides: Partial<ProfileAuditTargetDependencies> = {},
): ProfileAuditTargetDependencies {
  return {
    hasHostPermission: vi.fn(async () => true),
    queryTabs: vi.fn(async () => [tab('https://www.linkedin.com/feed/')]),
    updateTab: vi.fn(async () => tab(LINKEDIN_PROFILE_ME_URL, 'loading')),
    getTab: vi.fn(async () => tab(OWN_URL)),
    sendMessage: vi.fn(async () =>
      contentPong({
        url: OWN_URL,
        surface: 'profile',
        capabilities: { profile: 'ready' },
      }),
    ),
    reloadTab: vi.fn(async () => undefined),
    injectContentScript: vi.fn(async () => true),
    sleep: vi.fn(async () => undefined),
    maxAttempts: 3,
    ...overrides,
  };
}

describe('prepareProfileAuditTarget', () => {
  it('navigates the active exact LinkedIn tab to /in/me and accepts its self-profile redirect', async () => {
    const deps = dependencies();

    await expect(prepareProfileAuditTarget(deps)).resolves.toEqual({
      ok: true,
      tabId: 7,
      profileUrl: OWN_URL,
    });
    expect(deps.queryTabs).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(deps.updateTab).toHaveBeenCalledWith(7, LINKEDIN_PROFILE_ME_URL);
    expect(deps.sendMessage).toHaveBeenCalledWith(7, { type: 'PING' });
  });

  it('does not navigate or create a fallback when the active tab is not canonical LinkedIn', async () => {
    const deps = dependencies({ queryTabs: vi.fn(async () => [tab('https://example.com/')]) });

    await expect(prepareProfileAuditTarget(deps)).resolves.toEqual({
      ok: false,
      reason: 'no-linkedin-tab',
    });
    expect(deps.updateTab).not.toHaveBeenCalled();
  });

  it('fails before tab queries when host permission is missing', async () => {
    const deps = dependencies({ hasHostPermission: vi.fn(async () => false) });

    await expect(prepareProfileAuditTarget(deps)).resolves.toEqual({
      ok: false,
      reason: 'missing-host-permission',
    });
    expect(deps.queryTabs).not.toHaveBeenCalled();
  });

  it('reports an authentication redirect instead of unsupported DOM', async () => {
    const deps = dependencies({
      getTab: vi.fn(async () => tab('https://www.linkedin.com/login/')),
    });

    await expect(prepareProfileAuditTarget(deps)).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated',
    });
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('reloads one stale responsive content protocol before accepting the current reader', async () => {
    const pong = contentPong({
      url: OWN_URL,
      surface: 'profile',
      capabilities: { profile: 'ready' },
    });
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ ...pong, protocolVersion: pong.protocolVersion - 1 })
      .mockResolvedValueOnce(pong);
    const deps = dependencies({ sendMessage });

    await expect(prepareProfileAuditTarget(deps)).resolves.toMatchObject({ ok: true, tabId: 7 });
    expect(deps.reloadTab).toHaveBeenCalledTimes(1);
    expect(deps.injectContentScript).not.toHaveBeenCalled();
  });

  it('injects once after a missing receiver and fails boundedly when profile capability never becomes ready', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('no receiver'))
      .mockResolvedValue(
        contentPong({
          url: OWN_URL,
          surface: 'profile',
          capabilities: { profile: 'unsupported_dom' },
        }),
      );
    const deps = dependencies({ sendMessage, maxAttempts: 2 });

    await expect(prepareProfileAuditTarget(deps)).resolves.toEqual({
      ok: false,
      reason: 'unsupported-dom',
    });
    expect(deps.injectContentScript).toHaveBeenCalledTimes(1);
  });
});
