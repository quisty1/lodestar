import { defineComponent, h, type Ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import {
  runtimeError,
  runtimeOk,
  type StartProfileAuditRequest,
  type StartProfileAuditResponse,
} from '@lib/runtimeProtocol';
import { profileAuditFixture } from '@lib/profile/profileAudit.test-fixture';
import type { ProfileAuditResult } from '@lib/profile/contracts';
import { profileAuditErrorHint, useProfileAudit } from './useProfileAudit';

interface AuditApi {
  audit: Ref<ProfileAuditResult | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  start(): Promise<void>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function mountAudit(options: Parameters<typeof useProfileAudit>[0]) {
  let api: AuditApi | undefined;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useProfileAudit(options);
        return () => h('div');
      },
    }),
  );
  return {
    wrapper,
    get api() {
      return api!;
    },
  };
}

describe('useProfileAudit', () => {
  it('hydrates the stored result on mount without starting a new audit', async () => {
    const stored = profileAuditFixture({}, '2026-08-14T10:00:00.000Z');
    const start = vi.fn();
    const mounted = mountAudit({
      client: { start },
      repo: { latest: vi.fn(async () => stored) },
      available: () => true,
      createRequestId: () => 'request-1',
    });
    await flushPromises();

    expect(mounted.api.audit.value).toEqual(stored);
    expect(start).not.toHaveBeenCalled();
    mounted.wrapper.unmount();
  });

  it('shows pending, blocks duplicate starts and applies one successful result', async () => {
    const result = profileAuditFixture();
    const response = deferred<StartProfileAuditResponse>();
    const start = vi.fn((_request: StartProfileAuditRequest) => response.promise);
    const mounted = mountAudit({
      client: { start },
      repo: { latest: vi.fn(async () => null) },
      available: () => true,
      createRequestId: () => 'request-1',
    });
    await flushPromises();

    const first = mounted.api.start();
    const duplicate = mounted.api.start();
    expect(mounted.api.loading.value).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    response.resolve(runtimeOk({ requestId: 'request-1', result }));
    await Promise.all([first, duplicate]);

    expect(mounted.api.audit.value).toEqual(result);
    expect(mounted.api.loading.value).toBe(false);
    mounted.wrapper.unmount();
  });

  it('does not let slow hydration overwrite a newer manual result', async () => {
    const old = profileAuditFixture({}, '2026-08-14T10:00:00.000Z');
    const fresh = profileAuditFixture({}, '2026-08-15T12:00:00.000Z');
    const hydration = deferred<ProfileAuditResult | null>();
    const mounted = mountAudit({
      client: { start: vi.fn(async () => runtimeOk({ requestId: 'request-1', result: fresh })) },
      repo: { latest: vi.fn(() => hydration.promise) },
      available: () => true,
      createRequestId: () => 'request-1',
    });

    await mounted.api.start();
    hydration.resolve(old);
    await flushPromises();

    expect(mounted.api.audit.value).toEqual(fresh);
    mounted.wrapper.unmount();
  });

  it('settles errors and permits a retry', async () => {
    const result = profileAuditFixture();
    const start = vi
      .fn()
      .mockResolvedValueOnce(runtimeError('not-authenticated', 'no auth', true))
      .mockResolvedValueOnce(runtimeOk({ requestId: 'request-2', result }));
    let id = 0;
    const mounted = mountAudit({
      client: { start },
      repo: { latest: vi.fn(async () => null) },
      available: () => true,
      createRequestId: () => `request-${++id}`,
    });

    await mounted.api.start();
    expect(mounted.api.error.value).toMatch(/авториз/i);
    expect(mounted.api.loading.value).toBe(false);
    await mounted.api.start();
    expect(mounted.api.error.value).toBeNull();
    expect(mounted.api.audit.value).toEqual(result);
    mounted.wrapper.unmount();
  });
});

describe('profileAuditErrorHint', () => {
  it('maps runtime failures to actionable Russian copy', () => {
    expect(profileAuditErrorHint('no-linkedin-tab')).toMatch(/активн.*LinkedIn/i);
    expect(profileAuditErrorHint('not-authenticated')).toMatch(/авториз/i);
    expect(profileAuditErrorHint('unsupported-dom')).toMatch(/размет/i);
  });
});
