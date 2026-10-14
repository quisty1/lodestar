import { defineComponent, h, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { HttpClient, HttpGet } from '@lib/llm/contracts';
import type { LlmKeyStatus, LlmModel } from '@lib/llm/models';
import { listModels } from '../../service-worker/contentHandlers';
import { registerModelCatalogRuntime } from '../../service-worker/modelCatalogRuntime';
import { useLlmSettings } from './useLlmSettings';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

class CatalogHttp implements HttpClient, HttpGet {
  readonly calls: Array<{ url: string; headers: Record<string, string> }> = [];
  async postJson<T>(): Promise<T> {
    throw new Error('not used');
  }
  async getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
    this.calls.push({ url, headers });
    if (url.endsWith('/key')) return { data: { label: 'lodestar', is_management_key: false } } as T;
    return { data: [{ id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' }] } as T;
  }
}

describe('model catalog panel-to-worker feature boundary', () => {
  it('crosses mounted composable -> runtime listener -> real handler/provider -> panel truth', async () => {
    const listeners: Listener[] = [];
    const event = {
      addListener(listener: Listener) {
        listeners.push(listener);
      },
    };
    const dispatch = (message: unknown): Promise<unknown> =>
      new Promise((resolve, reject) => {
        let asynchronous = false;
        let responded = false;
        const respond = (value: unknown) => {
          if (!responded) {
            responded = true;
            resolve(value);
          }
        };
        try {
          for (const listener of [...listeners]) {
            if (listener(message, {}, respond) === true) asynchronous = true;
          }
        } catch (error) {
          reject(error instanceof Error ? error : new Error('listener failed'));
          return;
        }
        queueMicrotask(() => {
          if (!responded && !asynchronous) resolve(undefined);
        });
      });
    const http = new CatalogHttp();
    registerModelCatalogRuntime(event, (provider, apiKey) => listModels(http, provider, apiKey));
    (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
      runtime: { id: 'test-extension', sendMessage: vi.fn(dispatch), onMessage: event },
      storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
    } as unknown as typeof chrome;

    let api:
      | {
          config: Ref<{ provider: 'openrouter' | 'gemini'; apiKey: string }>;
          models: Ref<LlmModel[]>;
          keyStatus: Ref<LlmKeyStatus | null>;
          loading: Ref<boolean>;
          fetchModels(): Promise<void>;
        }
      | undefined;
    const wrapper = mount(
      defineComponent({
        setup() {
          api = useLlmSettings();
          return () => h('div');
        },
      }),
    );
    api!.config.value = { provider: 'openrouter', apiKey: ' sk-live ' };

    await api!.fetchModels();

    expect(api!.models.value).toEqual([{ id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' }]);
    expect(api!.keyStatus.value).toBe('valid');
    expect(api!.loading.value).toBe(false);
    expect(http.calls).toEqual([
      { url: 'https://openrouter.ai/api/v1/key', headers: { Authorization: 'Bearer sk-live' } },
      { url: 'https://openrouter.ai/api/v1/models', headers: { Authorization: 'Bearer sk-live' } },
    ]);
    wrapper.unmount();
  });
});
