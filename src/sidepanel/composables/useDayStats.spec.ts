import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { useDayStats } from './useDayStats';
import type { RunReport } from '@lib/types';

// Chrome.storage in-memory mock (matches the pattern in useContentSettings.spec).
const mem = new Map<string, unknown>();
function withTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
beforeEach(() => {
  mem.clear();
  (globalThis as any).chrome = {
    runtime: {
      id: 'x',
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
    storage: {
      local: {
        get: async (k: string) => ({ [k]: mem.get(k) }),
        set: async (o: Record<string, unknown>) => {
          for (const k in o) mem.set(k, o[k]);
        },
      },
    },
  };
});

// Mount the composable so onMounted runs (reload fires inside onMounted).
function harness() {
  let reload!: () => Promise<void>;
  const wrapper = mount(
    defineComponent({
      setup() {
        const r = useDayStats();
        reload = r.reload;
        return () => h('div', JSON.stringify(r.stats.value));
      },
    }),
  );
  return { wrapper, reload };
}

describe('useDayStats', () => {
  it('reads likes from autopilot:state.used (the live counter), not the dead engagement:budget:like key', async () => {
    const today = withTodayKey();
    // The live path bumps likes HERE (service-worker/index.ts s.used += 1).
    mem.set('autopilot:state', {
      day: today,
      used: 3,
      ceiling: 10,
      running: false,
    });
    // The old/never-written key — must be ignored even if present.
    mem.set('engagement:budget:like', { day: today, used: 99 });

    const { wrapper, reload } = harness();
    await reload();
    await wrapper.vm.$nextTick();

    const stats = JSON.parse(wrapper.text());
    expect(stats.likes).toEqual({ confirmed: 0, budget: 3 });
  });

  it('counts today posts from run reports, ignores other-day reports', async () => {
    const today = withTodayKey();
    const report: RunReport = {
      id: 'r1',
      startedAt: `${today}T10:00:00.000Z`,
      endedAt: `${today}T10:05:00.000Z`,
      host: 'tab',
      stopReason: 'manual',
      modules: [{ id: 'content', executed: 2, skipped: 0, failed: 0, reason: 'done' }],
    };
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const oldReport: RunReport = {
      id: 'r0',
      startedAt: `${yesterday}T10:00:00.000Z`,
      endedAt: `${yesterday}T10:05:00.000Z`,
      host: 'tab',
      stopReason: 'manual',
      modules: [{ id: 'content', executed: 5, skipped: 0, failed: 0, reason: 'done' }],
    };
    mem.set('autopilot:reports', [oldReport, report]);

    const { wrapper, reload } = harness();
    await reload();
    await wrapper.vm.$nextTick();

    const stats = JSON.parse(wrapper.text());
    expect(stats.posts).toEqual({ confirmed: 2, budget: 2 });
  });
});
