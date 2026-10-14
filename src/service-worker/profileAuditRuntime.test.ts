import { describe, expect, it, vi } from 'vitest';
import { runtimeError, type StartProfileAuditResponse } from '@lib/runtimeProtocol';
import type { Observation, ProfileAuditResult, ProfileSnapshot } from '@lib/profile/contracts';
import {
  registerProfileAuditRuntime,
  runProfileAudit,
  type ProfileAuditRuntimeDeps,
} from './profileAuditRuntime';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;
const known = <T>(value: T): Observation<T> => ({ state: 'known', value });

const snapshot: ProfileSnapshot = {
  capturedAt: '2026-08-15T12:00:00.000Z',
  profileUrl: 'https://www.linkedin.com/in/example/',
  photo: known(true),
  banner: known(true),
  headline: known({ present: true, length: 50, terms: ['frontend'] }),
  about: known({ present: true, length: 400 }),
  location: known(true),
  industry: { state: 'unknown' },
  currentPosition: known({ present: true, titleTerms: ['frontend'] }),
  educationCount: known(1),
  experience: known({ total: 2, past: 1, described: 2, quantified: 1 }),
  skills: known({ count: 12, terms: ['vue'] }),
  recommendations: known(true),
  featured: known(true),
  projects: known(true),
  publicUrl: known(true),
  openToWork: known({ enabled: true, titleTerms: ['frontend'] }),
  searchAppearances: known(5),
};

function dependencies(overrides: Partial<ProfileAuditRuntimeDeps> = {}): ProfileAuditRuntimeDeps {
  return {
    prepare: vi.fn(async () => ({ ok: true as const, tabId: 7, profileUrl: snapshot.profileUrl })),
    read: vi.fn(async (_tabId, requestId) => ({ ok: true, requestId, snapshot })),
    save: vi.fn(async () => undefined),
    now: () => new Date('2026-08-15T12:01:00.000Z'),
    ...overrides,
  };
}

describe('runProfileAudit', () => {
  it('validates the content snapshot, audits it and persists only the result', async () => {
    const deps = dependencies();

    const response = await runProfileAudit('request-1', deps);

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error('expected success');
    expect(response.data.requestId).toBe('request-1');
    expect(response.data.result.metrics.searchAppearances).toBe(5);
    expect(deps.save).toHaveBeenCalledWith(response.data.result);
    expect(JSON.stringify(vi.mocked(deps.save).mock.calls)).not.toContain('profile paragraph');
  });

  it('rejects a mismatched or malformed content envelope without saving', async () => {
    const deps = dependencies({
      read: vi.fn(async () => ({ ok: true, requestId: 'other', snapshot })),
    });

    await expect(runProfileAudit('request-1', deps)).resolves.toEqual(
      runtimeError('protocol-error', 'Некорректный ответ страницы LinkedIn.', false),
    );
    expect(deps.save).not.toHaveBeenCalled();
  });

  it('maps target failures to typed actionable runtime errors', async () => {
    const deps = dependencies({
      prepare: vi.fn(async () => ({ ok: false, reason: 'not-authenticated' }) as const),
    });

    await expect(runProfileAudit('request-1', deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'not-authenticated' },
    });
    expect(deps.read).not.toHaveBeenCalled();
  });
});

describe('registerProfileAuditRuntime', () => {
  it('deduplicates repeated requestId messages to the exact same worker promise', async () => {
    let listener: Listener | undefined;
    let resolveStart!: (value: StartProfileAuditResponse) => void;
    const success = {
      ok: true,
      data: { requestId: 'request-1', result: {} as ProfileAuditResult },
    } as const;
    const start = vi.fn(
      () =>
        new Promise<StartProfileAuditResponse>((resolve) => {
          resolveStart = resolve;
        }),
    );
    registerProfileAuditRuntime(
      {
        addListener: (next) => {
          listener = next;
        },
      },
      { start },
    );
    const first = vi.fn();
    const second = vi.fn();

    expect(listener!({ type: 'START_PROFILE_AUDIT', requestId: 'request-1' }, {}, first)).toBe(
      true,
    );
    expect(listener!({ type: 'START_PROFILE_AUDIT', requestId: 'request-1' }, {}, second)).toBe(
      true,
    );
    expect(start).toHaveBeenCalledTimes(1);
    resolveStart(success);
    await vi.waitFor(() => {
      expect(first).toHaveBeenCalledWith(success);
    });
    expect(second).toHaveBeenCalledWith(success);
  });

  it('rejects an empty requestId without invoking the service', () => {
    let listener: Listener | undefined;
    const start = vi.fn(async () => runtimeError('internal-error', 'no'));
    registerProfileAuditRuntime(
      {
        addListener: (next) => {
          listener = next;
        },
      },
      { start },
    );

    expect(listener!({ type: 'START_PROFILE_AUDIT', requestId: '' }, {}, vi.fn())).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});
