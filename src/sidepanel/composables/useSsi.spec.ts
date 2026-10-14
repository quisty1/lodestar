import { defineComponent, h, type Ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SsiSnapshot } from '@lib/types';
import type { RefreshResult } from '@lib/refresh/BackgroundRefreshService';
import { useSsi } from './useSsi';

interface SsiApi {
  snapshot: Ref<SsiSnapshot | null>;
  refreshing: Ref<boolean>;
  refreshError: Ref<string | null>;
  refresh(): Promise<void>;
}

let sendMessage: ReturnType<typeof vi.fn>;
let runtimeListener: ((message: unknown) => void) | undefined;

function mountComposable(): { api: SsiApi; unmount(): void } {
  let api: SsiApi | undefined;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useSsi();
        return () => h('div');
      },
    }),
  );
  return {
    api: api!,
    unmount: () => {
      wrapper.unmount();
    },
  };
}

beforeEach(() => {
  runtimeListener = undefined;
  sendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type === 'FORCE_REFRESH') return { status: 'busy' } satisfies RefreshResult;
    return undefined;
  });
  (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
    runtime: {
      id: 'test-extension',
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          runtimeListener = listener;
        }),
        removeListener: vi.fn(),
      },
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
  } as unknown as typeof chrome;
});

describe('useSsi manual refresh', () => {
  it.each([{ status: 'busy' }, { status: 'error', error: 'network' }, null])(
    'always clears the spinner for %#',
    async (result) => {
      sendMessage.mockImplementation(async (message: { type: string }) =>
        message.type === 'FORCE_REFRESH' ? result : undefined,
      );
      const { api, unmount } = mountComposable();
      await flushPromises();

      const before = api.snapshot.value;
      await api.refresh();

      expect(api.refreshing.value).toBe(false);
      expect(api.snapshot.value).toEqual(before);
      const expectsError = result === null || result.status === 'error';
      expect(api.refreshError.value).toBe(
        expectsError ? 'Не удалось обновить SSI. Показаны последние данные.' : null,
      );
      unmount();
    },
  );

  it('clears the spinner and keeps the last snapshot when runtime rejects', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'FORCE_REFRESH') throw new Error('worker unavailable');
      return undefined;
    });
    const { api, unmount } = mountComposable();
    await flushPromises();

    await api.refresh();

    expect(api.refreshing.value).toBe(false);
    expect(api.snapshot.value).toBeNull();
    expect(api.refreshError.value).toContain('Показаны последние данные');
    unmount();
  });

  it('fails closed on a malformed successful runtime response', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'FORCE_REFRESH' ? { status: 'refreshed', snapshot: null } : undefined,
    );
    const { api, unmount } = mountComposable();
    await flushPromises();

    await expect(api.refresh()).resolves.toBeUndefined();

    expect(api.refreshing.value).toBe(false);
    expect(api.snapshot.value).toBeNull();
    expect(api.refreshError.value).toContain('Показаны последние данные');
    unmount();
  });

  it('applies a refreshed response without waiting for a broadcast and clears old error', async () => {
    const fresh: SsiSnapshot = {
      total: 71,
      pillars: [
        { key: 'brand', label: 'Бренд', score: 18 },
        { key: 'people', label: 'Люди', score: 17 },
        { key: 'insights', label: 'Контент', score: 19 },
        { key: 'relationships', label: 'Отношения', score: 17 },
      ],
      capturedAt: '2026-08-11T12:00:00.000Z',
    };
    let forceCalls = 0;
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type !== 'FORCE_REFRESH') return undefined;
      forceCalls += 1;
      return forceCalls === 1
        ? { status: 'error', error: 'offline' }
        : { status: 'refreshed', snapshot: fresh };
    });
    const { api, unmount } = mountComposable();
    await flushPromises();

    await api.refresh();
    expect(api.refreshError.value).not.toBeNull();
    await api.refresh();

    expect(api.snapshot.value).toEqual(fresh);
    expect(api.refreshing.value).toBe(false);
    expect(api.refreshError.value).toBeNull();
    unmount();
  });

  it('ignores an unrelated content parse failure after a confirmed API refresh', async () => {
    const fresh: SsiSnapshot = {
      total: 69,
      pillars: [
        { key: 'brand', label: 'Бренд', score: 18 },
        { key: 'people', label: 'Люди', score: 17 },
        { key: 'insights', label: 'Контент', score: 18 },
        { key: 'relationships', label: 'Отношения', score: 16 },
      ],
      capturedAt: '2026-08-11T13:00:00.000Z',
    };
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === 'FORCE_REFRESH' ? { status: 'refreshed', snapshot: fresh } : undefined,
    );
    const { api, unmount } = mountComposable();
    await flushPromises();

    await api.refresh();
    runtimeListener!({
      type: 'SSI_PARSE_FAILED',
      reason: 'unrelated page parser',
    });

    expect(api.snapshot.value).toEqual(fresh);
    expect(api.refreshError.value).toBeNull();
    expect(api.refreshing.value).toBe(false);
    unmount();
  });

  it('does not settle an API refresh from an unrelated content parse failure', async () => {
    let release: (() => void) | undefined;
    sendMessage.mockImplementation((message: { type: string }) => {
      if (message.type !== 'FORCE_REFRESH') return Promise.resolve(undefined);
      return new Promise((resolve) => {
        release = () => {
          resolve({ status: 'error', error: 'parse' });
        };
      });
    });
    const { api, unmount } = mountComposable();
    await flushPromises();

    const pending = api.refresh();
    expect(api.refreshing.value).toBe(true);
    runtimeListener!({ type: 'SSI_PARSE_FAILED', reason: 'unsupported' });
    expect(api.refreshing.value).toBe(true);
    expect(api.refreshError.value).toBeNull();
    release!();
    await pending;
    expect(api.refreshing.value).toBe(false);
    expect(api.refreshError.value).not.toBeNull();
    unmount();
  });

  it('does not settle a pending API refresh from an unrelated snapshot broadcast', async () => {
    let release: (() => void) | undefined;
    sendMessage.mockImplementation((message: { type: string }) => {
      if (message.type !== 'FORCE_REFRESH') return Promise.resolve(undefined);
      return new Promise((resolve) => {
        release = () => {
          resolve({ status: 'busy' });
        };
      });
    });
    const broadcast: SsiSnapshot = {
      total: 66,
      pillars: [
        { key: 'brand', label: 'Бренд', score: 16 },
        { key: 'people', label: 'Люди', score: 16 },
        { key: 'insights', label: 'Контент', score: 17 },
        { key: 'relationships', label: 'Отношения', score: 17 },
      ],
      capturedAt: '2026-08-11T13:30:00.000Z',
    };
    const { api, unmount } = mountComposable();
    await flushPromises();

    const pending = api.refresh();
    runtimeListener!({ type: 'SSI_SNAPSHOT', payload: broadcast });

    expect(api.snapshot.value).toEqual(broadcast);
    expect(api.refreshing.value).toBe(true);
    release!();
    await pending;
    expect(api.refreshing.value).toBe(false);
    unmount();
  });
});
