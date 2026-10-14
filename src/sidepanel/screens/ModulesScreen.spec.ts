import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ModulesScreen from './ModulesScreen.vue';
import type { ModuleState } from '@lib/types';

function defaultModules(): ModuleState[] {
  const ids = ['engagement', 'smart_connect', 'profile_views', 'content'] as const;
  return ids.map((id) => ({
    id,
    enabled: true,
    automationLevel: 'auto_guardrails' as const,
    available: true,
    dailyLimit: 40,
  }));
}

beforeEach(() => {
  (globalThis as any).chrome = {
    runtime: { id: 'x', sendMessage: vi.fn().mockResolvedValue({}) },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
      },
    },
  };
});

describe('ModulesScreen', () => {
  it('renders a profile_views module card (toggle + daily limit)', () => {
    const wrapper = mount(ModulesScreen, { props: { modules: defaultModules() } });
    expect(wrapper.find('[data-testid="toggle-profile_views"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="limit-profile_views"]').exists()).toBe(true);
  });
});
