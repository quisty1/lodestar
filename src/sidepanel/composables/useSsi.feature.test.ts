import { defineComponent, h, type Ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import { SsiRepository } from '@lib/storage/SsiRepository';
import type { RefreshResult } from '@lib/refresh/BackgroundRefreshService';
import type { LodestarMessage, ProfileViewsSnapshot, SsiSnapshot } from '@lib/types';
import { registerSsiRefreshRuntime } from '../../service-worker/ssiRefreshRuntime';
import { useSsi } from './useSsi';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

interface SsiApi {
  snapshot: Ref<SsiSnapshot | null>;
  refreshing: Ref<boolean>;
  refreshError: Ref<string | null>;
  refresh(): Promise<void>;
}

describe('manual SSI refresh feature boundary', () => {
  it('crosses mounted panel -> Chrome runtime -> worker -> storage/broadcast -> panel', async () => {
    const fresh: SsiSnapshot = {
      total: 78,
      pillars: [
        { key: 'brand', label: 'Бренд', score: 20 },
        { key: 'people', label: 'Люди', score: 19 },
        { key: 'insights', label: 'Контент', score: 21 },
        { key: 'relationships', label: 'Отношения', score: 18 },
      ],
      capturedAt: '2026-08-11T14:00:00.000Z',
    };
    const listeners: Listener[] = [];
    const memory = new Map<string, unknown>();
    const event = {
      addListener(listener: Listener) {
        listeners.push(listener);
      },
      removeListener(listener: Listener) {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    };

    const dispatch = (message: unknown): Promise<unknown> =>
      new Promise((resolve, reject) => {
        let asynchronous = false;
        let responded = false;
        const sendResponse = (response: unknown) => {
          if (responded) return;
          responded = true;
          resolve(response);
        };
        try {
          for (const listener of [...listeners]) {
            if (listener(message, {}, sendResponse) === true) asynchronous = true;
          }
        } catch (error) {
          reject(error instanceof Error ? error : new Error('listener failed'));
          return;
        }
        queueMicrotask(() => {
          if (!responded && !asynchronous) resolve(undefined);
        });
      });
    const sendMessage = vi.fn(dispatch);

    (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
      runtime: { id: 'test-extension', sendMessage, onMessage: event },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: memory.get(key) })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) memory.set(key, value);
          }),
        },
      },
    } as unknown as typeof chrome;

    const repo = new SsiRepository(new ChromeStorageStore());
    registerSsiRefreshRuntime(event, {
      refreshSsi: vi.fn(async (): Promise<RefreshResult> => ({
        status: 'refreshed',
        snapshot: fresh,
      })),
      saveSsi: (snapshot) => repo.save(snapshot),
      broadcastSsi: (snapshot) => {
        void dispatch({
          type: 'SSI_SNAPSHOT',
          payload: snapshot,
        } satisfies LodestarMessage);
      },
      refreshProfileViews: vi.fn(async (): Promise<RefreshResult<ProfileViewsSnapshot>> => ({
        status: 'busy',
      })),
      saveProfileViews: vi.fn(async () => undefined),
      broadcastProfileViews: vi.fn(),
      onError: vi.fn(),
    });

    let api: SsiApi | undefined;
    const wrapper = mount(
      defineComponent({
        setup() {
          api = useSsi();
          return () => h('div');
        },
      }),
    );
    await flushPromises();

    await api!.refresh();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'FORCE_REFRESH' });
    expect(api!.snapshot.value).toEqual(fresh);
    expect(api!.refreshing.value).toBe(false);
    expect(api!.refreshError.value).toBeNull();
    expect(await repo.latest()).toEqual(fresh);
    wrapper.unmount();
  });
});
