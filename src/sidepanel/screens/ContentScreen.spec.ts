import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ContentScreen from './ContentScreen.vue';
import { isoWeekKey } from '@lib/content/PostWeekBudget';

function makeStorage() {
  const map = new Map<string, unknown>();
  return {
    get: vi.fn(async (keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const k of keyList) {
        if (map.has(k)) result[k] = map.get(k);
      }
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) map.set(k, v);
    }),
    _map: map,
  };
}

beforeEach(() => {
  (globalThis as any).chrome = {
    runtime: { id: 'x', sendMessage: vi.fn().mockResolvedValue({ ideas: [] }) },
    storage: { local: makeStorage() },
  };
});

describe('ContentScreen', () => {
  it('renders the Ideas / Drafts sub-tabs', () => {
    const wrapper = mount(ContentScreen);
    expect(wrapper.find('[data-testid="subtab-ideas"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="subtab-drafts"]').exists()).toBe(true);
  });

  it('approve button sets the flag and shows the badge; approve is NOT gated by postsLeft', async () => {
    const currentWeek = isoWeekKey(new Date());
    const draft = {
      id: 'draft-1',
      ideaTopic: 'Vue Tips',
      ideaAngle: 'Practical',
      text: 'Hello world',
      createdAt: new Date().toISOString(),
      approved: false,
    };
    // Seed storage: one draft, budget fully spent (postsLeft = 0)
    const storage = (globalThis as any).chrome.storage.local;
    storage._map.set('content:drafts', [draft]);
    storage._map.set('content:settings', { postsPerWeek: 1 });
    storage._map.set('posts:budget', { week: currentWeek, used: 1 });

    const w = mount(ContentScreen);
    await flushPromises();

    // Switch to drafts tab
    await w.find('[data-testid="subtab-drafts"]').trigger('click');
    await flushPromises();

    await w.get('[data-testid="open-draft-draft-1"]').trigger('click');

    // Approve button must exist and NOT be disabled even at postsLeft=0
    const approve = w.find('[data-testid^="approve-"]');
    expect(approve.exists()).toBe(true);
    expect(approve.attributes('disabled')).toBeUndefined();

    // Click approve → badge should appear
    await approve.trigger('click');
    await flushPromises();

    expect(w.find('[data-testid^="approved-badge-"]').exists()).toBe(true);
  });

  it('surfaces the last auto-collect status on the ideas tab (no more silent zero)', async () => {
    const storage = (globalThis as any).chrome.storage.local;
    storage._map.set('ideas:lastRun', {
      at: '2026-06-26T10:00:00Z',
      reason: 'budget_exhausted',
      stored: 0,
      budget: { used: 5, limit: 5 },
    });
    const w = mount(ContentScreen);
    await flushPromises();
    const line = w.find('[data-testid="ideas-last-run"]');
    expect(line.exists()).toBe(true);
    expect(line.text()).toContain('5/5');
  });
});
