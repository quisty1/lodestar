import { describe, expect, it, vi } from 'vitest';
import {
  CONTENT_PROTOCOL_VERSION,
  LINKEDIN_FEED_URL,
  LINKEDIN_MATCH_PATTERN,
  containsLinkedInHostPermission,
  hasLinkedInHostPermission,
  isLinkedInUrl,
  prepareRunTarget,
  prepareFeedTarget,
  reloadChromeTab,
  isContentPong,
  selectLinkedInTarget,
  type RunTargetDependencies,
  type TargetTab,
} from './runTarget';
import { contentPong } from './contentPong.test-fixture';

function tab(
  id: number,
  url: string,
  status: TargetTab['status'] = 'complete',
): TargetTab & { id: number } {
  return { id, url, status, windowId: 1, active: false };
}

function dependencies(overrides: Partial<RunTargetDependencies> = {}): RunTargetDependencies {
  return {
    hasHostPermission: vi.fn(async () => true),
    queryTabs: vi.fn(async () => []),
    createTab: vi.fn(async () => tab(99, LINKEDIN_FEED_URL)),
    updateTab: vi.fn(async (tabId, url) => tab(tabId, url)),
    getTab: vi.fn(async (tabId) => tab(tabId, LINKEDIN_FEED_URL)),
    sendMessage: vi.fn(async (_tabId, message) =>
      (message as { type?: string }).type === 'AUTOPILOT_ATTACH'
        ? { ok: true, runId: 'run-1', duplicate: false }
        : contentPong(),
    ),
    reloadTab: vi.fn(async () => undefined),
    injectContentScript: vi.fn(async () => true),
    sleep: vi.fn(async () => undefined),
    maxAttempts: 3,
    ...overrides,
  };
}

describe('run target', () => {
  it('production reload adapter forwards the exact tab id to chrome.tabs.reload', async () => {
    const reload = vi.fn(async (_tabId: number) => undefined);

    await reloadChromeTab({ reload }, 7);
    expect(reload).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('uses content protocol v5 after profile-audit reads became mandatory', () => {
    expect(CONTENT_PROTOCOL_VERSION).toBe(6);
  });

  it('accepts only tri-state surface/capability PONG envelopes', () => {
    expect(isContentPong(contentPong())).toBe(true);
    expect(
      isContentPong({
        type: 'PONG',
        protocolVersion: CONTENT_PROTOCOL_VERSION,
        url: LINKEDIN_FEED_URL,
        feedReady: true,
        activeRunId: null,
      }),
    ).toBe(false);
    expect(
      isContentPong({
        ...contentPong(),
        capabilities: { ...contentPong().capabilities, feed: 'future' },
      }),
    ).toBe(false);
  });

  it('prefers the active LinkedIn tab in the last-focused window', async () => {
    const active = tab(7, 'https://www.linkedin.com/in/me/');
    active.active = true;
    const feed = tab(8, LINKEDIN_FEED_URL);
    const deps = dependencies({
      queryTabs: vi.fn(async (query) => ('active' in query ? [active] : [feed])),
    });

    expect(await selectLinkedInTarget(deps)).toEqual({ ok: true, tab: active, created: false });
    expect(deps.createTab).not.toHaveBeenCalled();
  });

  it('rejects unsupported LinkedIn origins and selects only canonical www', async () => {
    expect(isLinkedInUrl('https://foo.linkedin.com/feed/')).toBe(false);
    expect(isLinkedInUrl('https://linkedin.com/feed/')).toBe(false);
    expect(isLinkedInUrl('http://www.linkedin.com/feed/')).toBe(false);

    const canonical = tab(9, 'https://www.linkedin.com/in/me/');
    const queryTabs = vi.fn(async (query: Record<string, unknown>) =>
      'active' in query ? [tab(7, 'https://foo.linkedin.com/feed/'), canonical] : [],
    );
    const deps = dependencies({ queryTabs });

    expect(await selectLinkedInTarget(deps)).toEqual({ ok: true, tab: canonical, created: false });
    expect(queryTabs).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
  });

  it('queries only the manifest-supported pattern for reusable tabs', async () => {
    const queryTabs = vi.fn(async () => []);
    const deps = dependencies({ queryTabs });

    await selectLinkedInTarget(deps);

    expect(queryTabs).toHaveBeenNthCalledWith(2, { url: LINKEDIN_MATCH_PATTERN });
  });

  it('fails before tab selection when LinkedIn site access was revoked', async () => {
    const deps = dependencies({ hasHostPermission: vi.fn(async () => false) });

    expect(await hasLinkedInHostPermission(deps)).toBe(false);
    expect(await selectLinkedInTarget(deps)).toEqual({
      ok: false,
      reason: 'missing-host-permission',
    });
    expect(deps.queryTabs).not.toHaveBeenCalled();
    expect(deps.createTab).not.toHaveBeenCalled();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('checks the Chrome permissions boundary with the manifest origin', async () => {
    const contains = vi.fn(async () => true);

    expect(await containsLinkedInHostPermission({ contains })).toBe(true);
    expect(contains).toHaveBeenCalledWith({ origins: [LINKEDIN_MATCH_PATTERN] });
  });

  it('reuses an existing feed before creating a tab', async () => {
    const feed = tab(8, LINKEDIN_FEED_URL);
    const deps = dependencies({
      queryTabs: vi.fn(async (query) =>
        'active' in query ? [] : [tab(2, 'https://www.linkedin.com/in/x/'), feed],
      ),
    });

    expect(await selectLinkedInTarget(deps)).toEqual({ ok: true, tab: feed, created: false });
  });

  it('creates the canonical feed when no LinkedIn tab exists', async () => {
    const deps = dependencies();

    expect(await selectLinkedInTarget(deps)).toEqual({
      ok: true,
      tab: tab(99, LINKEDIN_FEED_URL),
      created: true,
    });
    expect(deps.createTab).toHaveBeenCalledWith(LINKEDIN_FEED_URL);
  });

  it('navigates to feed, waits for complete and verifies the content protocol', async () => {
    let reads = 0;
    const deps = dependencies({
      getTab: vi.fn(async () => {
        reads += 1;
        return reads === 1 ? tab(7, LINKEDIN_FEED_URL, 'loading') : tab(7, LINKEDIN_FEED_URL);
      }),
    });

    const result = await prepareFeedTarget(
      deps,
      tab(7, 'https://www.linkedin.com/in/me/'),
      'run-1',
    );

    expect(result).toMatchObject({ ok: true, tabId: 7 });
    expect(deps.updateTab).toHaveBeenCalledWith(7, LINKEDIN_FEED_URL);
    expect(deps.sendMessage).toHaveBeenCalledWith(7, { type: 'PING' });
    expect(deps.sendMessage).toHaveBeenCalledWith(7, { type: 'AUTOPILOT_ATTACH', runId: 'run-1' });
  });

  it('accepts an explicitly empty feed contract instead of reporting unsupported DOM', async () => {
    const deps = dependencies({
      sendMessage: vi.fn(async (_tabId, message) =>
        (message as { type?: string }).type === 'AUTOPILOT_ATTACH'
          ? { ok: true, runId: 'run-1', duplicate: false }
          : contentPong({ capabilities: { feed: 'absent', like: 'absent', comment: 'absent' } }),
      ),
    });

    expect(await prepareFeedTarget(deps, tab(7, LINKEDIN_FEED_URL), 'run-1')).toMatchObject({
      ok: true,
      tabId: 7,
    });
  });

  it('keeps an already-open feed with a tracking query instead of reloading it', async () => {
    const currentUrl = 'https://www.linkedin.com/feed/?trk=homepage-basic_sign-in-submit';
    const deps = dependencies({
      getTab: vi.fn(async (tabId) => tab(tabId, currentUrl)),
      sendMessage: vi.fn(async (_tabId, message) =>
        (message as { type?: string }).type === 'AUTOPILOT_ATTACH'
          ? { ok: true, runId: 'run-1', duplicate: false }
          : contentPong({ url: currentUrl }),
      ),
    });

    expect(await prepareFeedTarget(deps, tab(7, currentUrl), 'run-1')).toMatchObject({
      ok: true,
      tabId: 7,
    });
    expect(deps.updateTab).not.toHaveBeenCalled();
    expect(deps.sendMessage).toHaveBeenCalledWith(7, { type: 'PING' });
    expect(deps.sendMessage).toHaveBeenCalledWith(7, { type: 'AUTOPILOT_ATTACH', runId: 'run-1' });
  });

  it('confirms an exact normalized origin and pathname before attaching a run', async () => {
    const deps = dependencies({
      getTab: vi.fn(async () => tab(7, 'https://www.linkedin.com/in/alex/', 'complete')),
    });

    expect(await prepareRunTarget(deps, 7, 'https://www.linkedin.com/in/al/', 'run-1')).toEqual({
      ok: false,
      reason: 'navigation_failed',
    });
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a stale people-search query even when origin and pathname match', async () => {
    const expected =
      'https://www.linkedin.com/search/results/people/?keywords=vue&geoUrn=%5B%22101282230%22%5D';
    const stale =
      'https://www.linkedin.com/search/results/people/?keywords=react&geoUrn=%5B%22102454843%22%5D';
    const deps = dependencies({
      getTab: vi.fn(async () => tab(7, stale, 'complete')),
    });

    expect(await prepareRunTarget(deps, 7, expected, 'run-1')).toEqual({
      ok: false,
      reason: 'navigation_failed',
    });
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('accepts reordered query pairs and ignores only hash and trailing slash differences', async () => {
    const expected =
      'https://www.linkedin.com/search/results/people/?keywords=vue&geoUrn=%5B%22101282230%22%5D';
    const equivalent =
      'https://www.linkedin.com/search/results/people?geoUrn=%5B%22101282230%22%5D&keywords=vue#results';
    const deps = dependencies({
      getTab: vi.fn(async () => tab(7, equivalent)),
      sendMessage: vi.fn(async (_tabId, message) =>
        (message as { type?: string }).type === 'AUTOPILOT_ATTACH'
          ? { ok: true, runId: 'run-1', duplicate: false }
          : contentPong({
              url: equivalent,
              surface: 'people_search',
              capabilities: {
                feed: 'absent',
                like: 'absent',
                comment: 'absent',
                connect: 'ready',
                pagination: 'ready',
                profile: 'ready',
              },
            }),
      ),
    });

    expect(await prepareRunTarget(deps, 7, expected, 'run-1')).toMatchObject({
      ok: true,
      tabId: 7,
    });
  });

  it('normalizes a relative LinkedIn profile href before navigation and exact-route checks', async () => {
    const profileUrl = 'https://www.linkedin.com/in/al/';
    const deps = dependencies({
      getTab: vi.fn(async () => tab(7, profileUrl)),
      sendMessage: vi.fn(async (_tabId, message) =>
        (message as { type?: string }).type === 'AUTOPILOT_ATTACH'
          ? { ok: true, runId: 'run-1', duplicate: false }
          : contentPong({
              url: profileUrl,
              surface: 'profile',
              capabilities: { feed: 'absent', like: 'absent', comment: 'absent', profile: 'ready' },
            }),
      ),
    });

    expect(await prepareRunTarget(deps, 7, '/in/al/', 'run-1')).toMatchObject({
      ok: true,
      tabId: 7,
    });
    expect(deps.updateTab).toHaveBeenCalledWith(7, profileUrl);
  });

  it('aborts navigation polling after STOP without pinging or attaching the new page', async () => {
    let stopped = false;
    const deps = dependencies({
      getTab: vi.fn(async () => tab(7, LINKEDIN_FEED_URL, 'loading')),
      sleep: vi.fn(async () => {
        stopped = true;
      }),
    });

    expect(
      await prepareRunTarget(deps, 7, LINKEDIN_FEED_URL, 'run-1', async () => stopped),
    ).toEqual({ ok: false, reason: 'navigation_failed' });
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.getTab).toHaveBeenCalledTimes(1);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'feed',
      (deps: RunTargetDependencies) =>
        prepareFeedTarget(deps, tab(7, 'https://www.linkedin.com/in/me/'), 'run-1', () => true),
    ],
    [
      'exact route',
      (deps: RunTargetDependencies) =>
        prepareRunTarget(deps, 7, 'https://www.linkedin.com/in/al/', 'run-1', () => true),
    ],
  ])('does not navigate an already-cancelled %s preparation', async (_name, prepare) => {
    const deps = dependencies();

    expect(await prepare(deps)).toEqual({ ok: false, reason: 'navigation_failed' });
    expect(deps.updateTab).not.toHaveBeenCalled();
    expect(deps.getTab).not.toHaveBeenCalled();
  });

  it('fails the target handshake when the freshly loaded content script rejects ATTACH', async () => {
    const deps = dependencies({
      sendMessage: vi.fn(async (_tabId, message) =>
        (message as { type?: string }).type === 'PING'
          ? contentPong()
          : { ok: false, runId: 'run-1', error: 'different-run-active' },
      ),
    });

    expect(await prepareFeedTarget(deps, tab(7, LINKEDIN_FEED_URL), 'run-1')).toEqual({
      ok: false,
      reason: 'unsupported_dom',
    });
  });

  it('reinjects the built content entry and retries when the receiver is missing', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('Receiving end does not exist'))
      .mockResolvedValueOnce(contentPong())
      .mockResolvedValueOnce({ ok: true, runId: 'run-1', duplicate: false });
    const deps = dependencies({ sendMessage, maxAttempts: 1 });

    expect(await prepareFeedTarget(deps, tab(7, LINKEDIN_FEED_URL), 'run-1')).toMatchObject({
      ok: true,
    });
    expect(deps.injectContentScript).toHaveBeenCalledWith(7);
    expect(deps.reloadTab).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it.each([
    [
      'v2',
      {
        type: 'PONG',
        protocolVersion: 2,
        url: LINKEDIN_FEED_URL,
        feedReady: true,
        activeRunId: null,
      },
    ],
    [
      'v1',
      {
        type: 'PONG',
        protocolVersion: 1,
        url: LINKEDIN_FEED_URL,
        feedReady: true,
        activeRunId: null,
      },
    ],
    [
      'missing-version',
      {
        type: 'PONG',
        url: LINKEDIN_FEED_URL,
        feedReady: true,
        activeRunId: null,
      },
    ],
  ])(
    'reinjects the current script and retries the handshake after a responsive %s PONG',
    async (_label, stalePong) => {
      let tabReads = 0;
      const sendMessage = vi
        .fn()
        .mockResolvedValueOnce(stalePong)
        .mockResolvedValueOnce(contentPong())
        .mockResolvedValueOnce({ ok: true, runId: 'run-1', duplicate: false });
      const deps = dependencies({
        sendMessage,
        getTab: vi.fn(async (tabId) => {
          tabReads += 1;
          return tab(tabId, LINKEDIN_FEED_URL, tabReads === 2 ? 'loading' : 'complete');
        }),
        maxAttempts: 2,
      });

      expect(await prepareFeedTarget(deps, tab(7, LINKEDIN_FEED_URL), 'run-1')).toMatchObject({
        ok: true,
      });
      expect(deps.injectContentScript).toHaveBeenCalledExactlyOnceWith(7);
      expect(deps.reloadTab).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledTimes(3);
    },
  );

  it('reloads once and retries after an invalid ATTACH acknowledgement', async () => {
    const pong = contentPong();
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(pong)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(pong)
      .mockResolvedValueOnce({ ok: true, runId: 'run-1', duplicate: false });
    const deps = dependencies({ sendMessage, maxAttempts: 1 });

    expect(await prepareFeedTarget(deps, tab(7, LINKEDIN_FEED_URL), 'run-1')).toMatchObject({
      ok: true,
    });
    expect(deps.reloadTab).toHaveBeenCalledOnce();
    expect(deps.injectContentScript).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(4);
  });

  it('never reloads more than once while an old content protocol persists', async () => {
    const deps = dependencies({
      sendMessage: vi.fn(async () => ({
        type: 'PONG',
        protocolVersion: 1,
        url: LINKEDIN_FEED_URL,
        feedReady: true,
        activeRunId: null,
      })),
    });

    expect(await prepareFeedTarget(deps, tab(7, LINKEDIN_FEED_URL), 'run-1')).toEqual({
      ok: false,
      reason: 'navigation_failed',
    });
    expect(deps.injectContentScript).toHaveBeenCalledOnce();
    expect(deps.reloadTab).toHaveBeenCalledOnce();
  });

  it('stops an orphan content loop before accepting the target', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(contentPong({ activeRunId: 'old-run' }))
      .mockResolvedValueOnce({ ok: true, stopped: true })
      .mockResolvedValueOnce(contentPong())
      .mockResolvedValueOnce({ ok: true, runId: 'run-1', duplicate: false });
    const deps = dependencies({ sendMessage });

    expect(await prepareFeedTarget(deps, tab(7, LINKEDIN_FEED_URL), 'run-1')).toMatchObject({
      ok: true,
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 7, { type: 'STOP_AUTOPILOT', runId: 'old-run' });
  });

  it('returns navigation_failed when the target never reaches a complete feed', async () => {
    const deps = dependencies({
      getTab: vi.fn(async () => tab(7, 'https://www.linkedin.com/in/me/', 'complete')),
    });

    expect(
      await prepareFeedTarget(deps, tab(7, 'https://www.linkedin.com/in/me/'), 'run-1'),
    ).toEqual({
      ok: false,
      reason: 'navigation_failed',
    });
  });

  it('returns unsupported_dom when content responds on feed without a usable feed root', async () => {
    const deps = dependencies({
      sendMessage: vi.fn(async () => contentPong({ capabilities: { feed: 'unsupported_dom' } })),
    });

    expect(await prepareFeedTarget(deps, tab(7, LINKEDIN_FEED_URL), 'run-1')).toEqual({
      ok: false,
      reason: 'unsupported_dom',
    });
    expect(deps.sendMessage).toHaveBeenCalledTimes(3);
  });
});
