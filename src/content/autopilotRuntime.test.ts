import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTENT_PROTOCOL_VERSION } from '@lib/runtimeProtocol';
import type { LinkedInDomCapabilities } from '@lib/types';
import { __resetActivity, clearActivity, hideActivity, showActivity } from './activityOverlay';
import { ContentRunSession } from './runSession';
import {
  registerContentAutopilotRuntime,
  type ContentAutopilotRuntimeDependencies,
} from './autopilotRuntime';

const READY_CONTRACT = {
  surface: 'feed' as const,
  capabilities: {
    feed: 'ready' as const,
    like: 'ready' as const,
    comment: 'ready' as const,
    connect: 'absent' as const,
    pagination: 'absent' as const,
    profile: 'absent' as const,
    ssi: 'absent' as const,
  },
};

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined;

function setup(overrides: Partial<ContentAutopilotRuntimeDependencies> = {}) {
  let listener: Listener | undefined;
  const event = {
    addListener: vi.fn((next: Listener) => {
      listener = next;
    }),
  };
  const dependencies: ContentAutopilotRuntimeDependencies = {
    session: new ContentRunSession(),
    currentUrl: () => 'https://www.linkedin.com/feed/',
    inspectDom: () => READY_CONTRACT,
    startRunLoop: vi.fn(),
    endRun: vi.fn(async () => undefined),
    clearActivity: vi.fn(),
    ...overrides,
  };
  registerContentAutopilotRuntime(event, dependencies);
  if (!listener) throw new Error('listener not registered');
  const dispatch = (message: unknown) => {
    let response: unknown;
    const returned = listener!(message, {}, (value) => {
      response = value;
    });
    return { returned, response };
  };
  return { dependencies, dispatch };
}

const modules = { engagement: true, content: false, comments: false };

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  __resetActivity();
});

describe('registered content autopilot runtime boundary', () => {
  it('answers PING with protocol, route readiness, and active run identity', () => {
    const session = new ContentRunSession();
    session.begin('run-1');
    const { dispatch } = setup({ session });

    expect(dispatch({ type: 'PING' })).toEqual({
      returned: false,
      response: {
        type: 'PONG',
        protocolVersion: CONTENT_PROTOCOL_VERSION,
        url: 'https://www.linkedin.com/feed/',
        ...READY_CONTRACT,
        activeRunId: 'run-1',
      },
    });
  });

  it.each([
    { type: 'AUTOPILOT_ATTACH' },
    { type: 'AUTOPILOT_ATTACH', runId: '' },
    { type: 'AUTOPILOT_RUN_LOOP', modules },
    { type: 'AUTOPILOT_RUN_LOOP', runId: '', modules },
  ])('rejects an invalid run identity without reserving or starting: $type', (message) => {
    const { dependencies, dispatch } = setup();

    expect(dispatch(message)).toEqual({
      returned: false,
      response: { ok: false, error: 'invalid-run-id' },
    });
    expect(dependencies.session.activeRunId).toBeNull();
    expect(dependencies.startRunLoop).not.toHaveBeenCalled();
  });

  it.each([{ type: 'STOP_AUTOPILOT' }, { type: 'STOP_AUTOPILOT', runId: '' }])(
    'rejects an invalid STOP identity without stopping the active run',
    (message) => {
      const { dependencies, dispatch } = setup();
      dispatch({ type: 'AUTOPILOT_ATTACH', runId: 'run-1' });
      vi.mocked(dependencies.clearActivity).mockClear();

      expect(dispatch(message)).toEqual({
        returned: false,
        response: { ok: false, error: 'invalid-run-id' },
      });
      expect(dependencies.session.activeRunId).toBe('run-1');
      expect(dependencies.clearActivity).not.toHaveBeenCalled();
    },
  );

  it('rejects RUN_LOOP off feed without starting the loop', () => {
    const { dependencies, dispatch } = setup({
      inspectDom: () => ({ ...READY_CONTRACT, surface: 'unknown' }),
    });

    expect(dispatch({ type: 'AUTOPILOT_RUN_LOOP', runId: 'run-1', modules })).toEqual({
      returned: false,
      response: { ok: false, error: 'wrong-page' },
    });
    expect(dependencies.startRunLoop).not.toHaveBeenCalled();
  });

  it('rejects RUN_LOOP with unsupported_dom when the required feed contract is unsupported', () => {
    const overrides = {
      inspectDom: () => ({
        ...READY_CONTRACT,
        capabilities: {
          ...READY_CONTRACT.capabilities,
          feed: 'unsupported_dom' as const,
        },
      }),
    };
    const { dependencies, dispatch } = setup(overrides);

    expect(dispatch({ type: 'AUTOPILOT_RUN_LOOP', runId: 'run-1', modules })).toEqual({
      returned: false,
      response: { ok: false, error: 'unsupported_dom' },
    });
    expect(dependencies.startRunLoop).not.toHaveBeenCalled();
  });

  it('starts RUN_LOOP when the feed is ready but the reaction state is unknown', () => {
    const { dependencies, dispatch } = setup({
      inspectDom: () => ({
        ...READY_CONTRACT,
        capabilities: {
          ...READY_CONTRACT.capabilities,
          like: 'unsupported_dom',
        },
      }),
    });
    dependencies.session.attach('run-1');

    expect(
      dispatch({
        type: 'AUTOPILOT_RUN_LOOP',
        runId: 'run-1',
        modules,
      }),
    ).toMatchObject({
      response: { ok: true, runId: 'run-1' },
    });
    expect(dependencies.startRunLoop).toHaveBeenCalledWith('run-1', modules);
  });

  it('starts likes when the comment control is unsupported and skips comments', () => {
    const requested = { engagement: true, content: false, comments: true };
    const { dependencies, dispatch } = setup({
      inspectDom: () => ({
        ...READY_CONTRACT,
        capabilities: {
          ...READY_CONTRACT.capabilities,
          comment: 'unsupported_dom' as const,
        },
      }),
    });
    dependencies.session.attach('run-1');

    expect(
      dispatch({
        type: 'AUTOPILOT_RUN_LOOP',
        runId: 'run-1',
        modules: requested,
      }),
    ).toMatchObject({
      response: { ok: true, runId: 'run-1' },
    });
    expect(dependencies.startRunLoop).toHaveBeenCalledWith('run-1', {
      engagement: true,
      content: false,
      comments: false,
    });
  });

  it('allows an explicitly empty supported feed to reach normal feed exhaustion', () => {
    const empty: LinkedInDomCapabilities = {
      feed: 'absent',
      like: 'absent',
      comment: 'absent',
      connect: 'absent',
      pagination: 'absent',
      profile: 'absent',
      ssi: 'absent',
    };
    const { dependencies, dispatch } = setup({
      inspectDom: () => ({ ...READY_CONTRACT, capabilities: empty }),
    });
    dispatch({ type: 'AUTOPILOT_ATTACH', runId: 'run-1' });

    expect(dispatch({ type: 'AUTOPILOT_RUN_LOOP', runId: 'run-1', modules })).toMatchObject({
      response: { ok: true },
    });
    expect(dependencies.startRunLoop).toHaveBeenCalledOnce();
  });

  it('captures ATTACH at the runtime boundary and starts the reserved run loop once', () => {
    const { dependencies, dispatch } = setup();

    expect(dispatch({ type: 'AUTOPILOT_ATTACH', runId: 'run-1' })).toEqual({
      returned: false,
      response: { ok: true, runId: 'run-1', duplicate: false },
    });
    expect(dispatch({ type: 'AUTOPILOT_ATTACH', runId: 'run-1' })).toEqual({
      returned: false,
      response: { ok: true, runId: 'run-1', duplicate: true },
    });
    expect(dispatch({ type: 'AUTOPILOT_RUN_LOOP', runId: 'run-1', modules })).toEqual({
      returned: false,
      response: { ok: true, runId: 'run-1', duplicate: false },
    });
    expect(dispatch({ type: 'AUTOPILOT_RUN_LOOP', runId: 'run-1', modules })).toEqual({
      returned: false,
      response: { ok: true, runId: 'run-1', duplicate: true },
    });
    expect(dependencies.startRunLoop).toHaveBeenCalledTimes(1);
  });

  it('stops a reserved run before any loop can start', () => {
    const { dependencies, dispatch } = setup();
    dispatch({ type: 'AUTOPILOT_ATTACH', runId: 'run-1' });

    expect(dispatch({ type: 'STOP_AUTOPILOT', runId: 'run-1' })).toEqual({
      returned: false,
      response: { ok: true, stopped: true, activeRunId: null },
    });
    expect(dispatch({ type: 'AUTOPILOT_RUN_LOOP', runId: 'run-1', modules })).toEqual({
      returned: false,
      response: { ok: true, runId: 'run-1', duplicate: true },
    });
    expect(dependencies.startRunLoop).not.toHaveBeenCalled();
  });

  it('accepts one run, idempotently acknowledges it, and rejects a different active run', () => {
    const { dependencies, dispatch } = setup();

    dispatch({ type: 'AUTOPILOT_ATTACH', runId: 'run-1' });

    expect(dispatch({ type: 'AUTOPILOT_RUN_LOOP', runId: 'run-1', modules })).toEqual({
      returned: false,
      response: { ok: true, runId: 'run-1', duplicate: false },
    });
    expect(dispatch({ type: 'AUTOPILOT_RUN_LOOP', runId: 'run-1', modules })).toEqual({
      returned: false,
      response: { ok: true, runId: 'run-1', duplicate: true },
    });
    expect(dispatch({ type: 'AUTOPILOT_RUN_LOOP', runId: 'run-2', modules })).toEqual({
      returned: false,
      response: {
        ok: false,
        runId: 'run-2',
        duplicate: false,
        error: 'different-run-active',
      },
    });
    expect(dependencies.startRunLoop).toHaveBeenCalledTimes(1);
    expect(dependencies.startRunLoop).toHaveBeenCalledWith('run-1', modules);
  });

  it('ignores mismatched STOP and settles matching scoped STOP', () => {
    const { dependencies, dispatch } = setup();
    dispatch({ type: 'AUTOPILOT_ATTACH', runId: 'run-1' });
    dispatch({ type: 'AUTOPILOT_RUN_LOOP', runId: 'run-1', modules });
    vi.mocked(dependencies.clearActivity).mockClear();

    expect(dispatch({ type: 'STOP_AUTOPILOT', runId: 'old-run' })).toEqual({
      returned: false,
      response: { ok: true, stopped: false, activeRunId: 'run-1' },
    });
    expect(dependencies.clearActivity).not.toHaveBeenCalled();

    expect(dispatch({ type: 'STOP_AUTOPILOT', runId: 'run-1' })).toEqual({
      returned: false,
      response: { ok: true, stopped: true, activeRunId: null },
    });
    expect(dependencies.clearActivity).toHaveBeenCalledOnce();
  });

  it('force-clears repeated run stage activity on STOP and starts the next run cleanly', () => {
    const { dispatch } = setup({
      clearActivity: () => {
        clearActivity(document);
      },
    });
    dispatch({ type: 'AUTOPILOT_ATTACH', runId: 'run-1' });
    showActivity(document, 'SEARCHING');
    showActivity(document, 'CONNECTING');
    showActivity(document, 'CONNECTING');

    dispatch({ type: 'STOP_AUTOPILOT', runId: 'run-1' });
    expect(document.getElementById('lodestar-activity-overlay')?.getAttribute('data-on')).toBe('0');
    expect(document.getElementById('lodestar-activity-label')?.textContent).toBe('');

    dispatch({ type: 'STOP_AUTOPILOT', runId: 'run-1' });
    showActivity(document, 'stale prior run');
    showActivity(document, 'stale prior run');
    dispatch({ type: 'AUTOPILOT_ATTACH', runId: 'run-2' });
    showActivity(document, 'next run');
    hideActivity(document);
    expect(document.getElementById('lodestar-activity-overlay')?.getAttribute('data-on')).toBe('0');
  });

  it('contains a rejected loop and reports its scoped error end', async () => {
    const { dependencies, dispatch } = setup({
      startRunLoop: vi.fn(async () => {
        throw new Error('DOM changed');
      }),
    });

    dispatch({ type: 'AUTOPILOT_ATTACH', runId: 'run-1' });
    dispatch({ type: 'AUTOPILOT_RUN_LOOP', runId: 'run-1', modules });
    await vi.waitFor(() => {
      expect(dependencies.endRun).toHaveBeenCalledOnce();
    });

    expect(dependencies.endRun).toHaveBeenCalledWith('run-1', 'error');
  });
});
