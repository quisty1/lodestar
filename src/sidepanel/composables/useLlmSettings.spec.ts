import { beforeEach, describe, expect, it, vi } from 'vitest';
import { panelBus } from '../lib/panelBus';
import { useLlmSettings } from './useLlmSettings';

const mem = new Map<string, unknown>();

beforeEach(() => {
  vi.restoreAllMocks();
  mem.clear();
  (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
    runtime: {
      id: 'x',
      sendMessage: vi.fn().mockResolvedValue({
        models: [{ id: 'm1', label: 'M1' }],
        source: 'live',
        keyStatus: 'valid',
      }),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: mem.get(key) })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const key in values) mem.set(key, values[key]);
        }),
      },
    },
  } as unknown as typeof chrome;
});

describe('useLlmSettings', () => {
  it('saves and reloads the config', async () => {
    const settings = useLlmSettings();
    settings.config.value = { provider: 'gemini', apiKey: 'AIza', model: 'gemini-2.5-flash' };
    await settings.save();

    const reloaded = useLlmSettings();
    await reloaded.load();

    expect(reloaded.config.value).toEqual({
      provider: 'gemini',
      apiKey: 'AIza',
      model: 'gemini-2.5-flash',
    });
  });

  it('uses explicit live catalog truth instead of inferring validity from model count', async () => {
    const settings = useLlmSettings();
    await settings.fetchModels();

    expect(settings.models.value).toEqual([{ id: 'm1', label: 'M1' }]);
    expect(settings.catalogSource.value).toBe('live');
    expect(settings.keyStatus.value).toBe('valid');
  });

  it.each([
    ['invalid', 'auth_rejected'],
    ['unknown', 'provider_unavailable'],
  ] as const)('keeps a non-empty fallback catalog key status %s', async (keyStatus, reason) => {
    (globalThis.chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      models: [{ id: 'fallback-model' }],
      source: 'fallback',
      keyStatus,
      reason,
    });
    const settings = useLlmSettings();

    await settings.fetchModels();

    expect(settings.models.value).toEqual([{ id: 'fallback-model' }]);
    expect(settings.catalogSource.value).toBe('fallback');
    expect(settings.keyStatus.value).toBe(keyStatus);
    expect(settings.statusReason.value).toBe(reason);
  });

  it('marks transport failure unknown because the key was not checked', async () => {
    (globalThis.chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('no sw'),
    );
    const settings = useLlmSettings();

    await settings.fetchModels();

    expect(settings.keyStatus.value).toBe('unknown');
    expect(settings.statusReason.value).toBe('transport_unavailable');
  });

  it('does not treat a legacy bare model array as proof of key validity', async () => {
    (globalThis.chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'legacy-model' },
    ]);
    const settings = useLlmSettings();

    await settings.fetchModels();

    expect(settings.models.value).toEqual([]);
    expect(settings.keyStatus.value).toBe('unknown');
    expect(settings.statusReason.value).toBe('protocol_error');
  });

  it('always releases loading when the request unexpectedly rejects', async () => {
    vi.spyOn(panelBus, 'request').mockRejectedValueOnce(new Error('unexpected'));
    const settings = useLlmSettings();

    await expect(settings.fetchModels()).resolves.toBeUndefined();

    expect(settings.loading.value).toBe(false);
    expect(settings.keyStatus.value).toBe('unknown');
  });

  it('ignores an old credential response without clearing a newer request', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    (globalThis.chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const settings = useLlmSettings();
    settings.config.value.apiKey = 'old-key';
    const oldRequest = settings.fetchModels();

    settings.config.value.apiKey = 'new-key';
    settings.resetVerification();
    const newRequest = settings.fetchModels();
    resolvers[0]({ models: [{ id: 'old-model' }], source: 'live', keyStatus: 'valid' });
    await Promise.resolve();
    await Promise.resolve();

    expect(settings.loading.value).toBe(true);
    expect(settings.keyStatus.value).toBeNull();
    expect(settings.models.value).toEqual([]);

    resolvers[1]({ models: [{ id: 'new-model' }], source: 'live', keyStatus: 'valid' });
    await Promise.all([oldRequest, newRequest]);

    expect(settings.loading.value).toBe(false);
    expect(settings.keyStatus.value).toBe('valid');
    expect(settings.models.value).toEqual([{ id: 'new-model' }]);
  });
});
