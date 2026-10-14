import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import SettingsScreen from './SettingsScreen.vue';

beforeEach(() => {
  (globalThis as any).chrome = {
    runtime: {
      id: 'x',
      sendMessage: vi.fn().mockResolvedValue({ models: [], source: 'live', keyStatus: 'valid' }),
    },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
  };
});

describe('SettingsScreen', () => {
  it('renders the provider select and a password key input', () => {
    const wrapper = mount(SettingsScreen);
    expect(wrapper.find('[data-testid="llm-provider"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="llm-key"]').attributes('type')).toBe('password');
    expect(wrapper.find('[data-testid="llm-save"]').exists()).toBe(true);
  });

  it('shows a save error when a save fails', async () => {
    (globalThis as any).chrome.storage.local.set = vi.fn().mockRejectedValue(new Error('quota'));
    const wrapper = mount(SettingsScreen);
    await flushPromises();
    await wrapper.find('[data-testid="llm-save"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="save-error"]').exists()).toBe(true);
  });

  it('shows that the provider confirmed a valid key', async () => {
    (globalThis as any).chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      models: [{ id: 'openai/gpt-4o-mini' }],
      source: 'live',
      keyStatus: 'valid',
    });
    const wrapper = mount(SettingsScreen);
    await wrapper.find('[data-testid="llm-fetch"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="llm-valid"]').text()).toContain('Ключ подтверждён');
  });

  it('clears stale key confirmation when the key changes', async () => {
    (globalThis as any).chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      models: [{ id: 'openai/gpt-4o-mini' }],
      source: 'live',
      keyStatus: 'valid',
    });
    const wrapper = mount(SettingsScreen);
    await wrapper.find('[data-testid="llm-fetch"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="llm-valid"]').exists()).toBe(true);

    await wrapper.find('[data-testid="llm-key"]').setValue('another-key');

    expect(wrapper.find('[data-testid="llm-valid"]').exists()).toBe(false);
  });

  it('shows that the provider rejected an invalid key despite fallback models', async () => {
    (globalThis as any).chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      models: [{ id: 'gemini-2.5-flash' }],
      source: 'fallback',
      keyStatus: 'invalid',
      reason: 'auth_rejected',
    });
    const wrapper = mount(SettingsScreen);
    await wrapper.find('[data-testid="llm-fetch"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="llm-invalid"]').text()).toContain(
      'Ключ отклонён провайдером',
    );
    expect(wrapper.find('[data-testid="llm-valid"]').exists()).toBe(false);
  });

  it('explains that an OpenRouter management key cannot generate content', async () => {
    (globalThis as any).chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      models: [{ id: 'openai/gpt-4o-mini' }],
      source: 'fallback',
      keyStatus: 'invalid',
      reason: 'management_key',
    });
    const wrapper = mount(SettingsScreen);
    await wrapper.find('[data-testid="llm-fetch"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="llm-invalid"]').text()).toContain('Management key');
    expect(wrapper.find('[data-testid="llm-invalid"]').text()).toContain('не подходит');
  });

  it('shows provider unavailable and explicitly says the key was not checked', async () => {
    (globalThis as any).chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      models: [{ id: 'gemini-2.5-flash' }],
      source: 'fallback',
      keyStatus: 'unknown',
      reason: 'provider_unavailable',
    });
    const wrapper = mount(SettingsScreen);
    await wrapper.find('[data-testid="llm-fetch"]').trigger('click');
    await flushPromises();

    const message = wrapper.find('[data-testid="llm-unknown"]').text();
    expect(message).toContain('Провайдер недоступен');
    expect(message).toContain('ключ не проверен');
  });

  it('renders 7 publish-day checkboxes defaulting to Mon/Wed/Fri', async () => {
    const w = mount(SettingsScreen);
    await flushPromises();
    expect(w.find('[data-testid="pubday-1"]').exists()).toBe(true);
    expect(w.find('[data-testid="pubday-0"]').exists()).toBe(true);
    expect((w.find('[data-testid="pubday-1"]').element as HTMLInputElement).checked).toBe(true); // Mon
    expect((w.find('[data-testid="pubday-2"]').element as HTMLInputElement).checked).toBe(false); // Tue
  });

  it('toggles a publish weekday and persists publishDays without it', async () => {
    const setMock = vi.fn(async (_obj: Record<string, any>) => {});
    (globalThis as any).chrome.storage.local.set = setMock;
    const w = mount(SettingsScreen);
    await flushPromises();
    await w.find('[data-testid="pubday-1"]').setValue(false); // un-check Monday (default [1,3,5])
    await w.find('[data-testid="llm-save"]').trigger('click');
    await flushPromises();
    const call = setMock.mock.calls.find((c) => c[0] && c[0]['content:settings']);
    expect(call?.[0]['content:settings'].publishDays).toEqual([3, 5]);
  });
});
