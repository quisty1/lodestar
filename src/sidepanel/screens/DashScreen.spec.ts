import { describe, expect, it } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import type { ProfileViewsSnapshot, SsiSnapshot } from '@lib/types';
import { pillarsToView } from '../lib/ssiView';
import { capturedLabel } from '../lib/capturedLabel';
import DashScreen from './DashScreen.vue';

const SNAPSHOT: SsiSnapshot = {
  total: 70,
  pillars: [
    { key: 'brand', label: 'Профессиональный бренд', score: 18 },
    { key: 'people', label: 'Поиск нужных людей', score: 16 },
    { key: 'insights', label: 'Обмен инсайтами', score: 20 },
    { key: 'relationships', label: 'Построение связей', score: 16 },
  ],
  capturedAt: '2026-08-11T00:00:00.000Z',
};

const PV_HISTORY: ProfileViewsSnapshot[] = [
  { count: 12, windowDays: 90, capturedAt: '2026-08-11T00:00:00.000Z' },
];

function render(overrides: Record<string, unknown> = {}) {
  return shallowMount(DashScreen, {
    props: {
      snapshot: SNAPSHOT,
      pillars: pillarsToView(SNAPSHOT),
      total: SNAPSHOT.total,
      history: [SNAPSHOT],
      pvHistory: PV_HISTORY,
      pvIsReal: true,
      isReal: true,
      refreshing: false,
      autopilotRunning: false,
      autopilotPending: null,
      ...overrides,
    },
  });
}

describe('DashScreen autopilot controls', () => {
  it('shows the profile audit entry and only emits navigation on click', async () => {
    const wrapper = render();

    await wrapper.get('[data-testid="open-audit"]').trigger('click');

    expect(wrapper.emitted('openAudit')).toHaveLength(1);
  });

  it('renders coordinator-owned starting state', () => {
    const wrapper = render({ autopilotPending: 'starting' });
    const launch = wrapper.get('[data-testid="ap-launch"]');

    expect(launch.text()).toBe('Запускаю…');
    expect(launch.attributes('disabled')).toBeDefined();
  });

  it('renders coordinator-owned stopping state for a hydrated run', () => {
    const wrapper = render({
      autopilotRunning: true,
      autopilotPending: 'stopping',
    });
    const launch = wrapper.get('[data-testid="ap-launch"]');

    expect(launch.text()).toBe('Останавливаю…');
    expect(launch.attributes('disabled')).toBeDefined();
  });

  it('emits START or STOP only when no operation is pending', async () => {
    const idle = render();
    await idle.get('[data-testid="ap-launch"]').trigger('click');
    expect(idle.emitted('startAutopilot')).toHaveLength(1);

    const running = render({ autopilotRunning: true });
    await running.get('[data-testid="ap-launch"]').trigger('click');
    expect(running.emitted('stopAutopilot')).toHaveLength(1);

    const pending = render({ autopilotPending: 'starting' });
    await pending.get('[data-testid="ap-launch"]').trigger('click');
    expect(pending.emitted('startAutopilot')).toBeUndefined();
  });

  it('keeps an actionable STOP failure visible while the run is still active', () => {
    const wrapper = render({
      autopilotRunning: true,
      startHint: 'Не удалось остановить запуск.',
    });

    expect(wrapper.get('[data-testid="ap-runtime-hint"]').text()).toContain(
      'Не удалось остановить',
    );
  });

  it('renders honest SSI refresh copy and a retained-data error', () => {
    const idle = render();
    expect(idle.get('[data-testid="refresh-ssi"]').text()).toBe('Обновить SSI');

    const refreshing = render({ refreshing: true });
    expect(refreshing.get('[data-testid="refresh-ssi"]').text()).toBe('Обновляю SSI…');

    const failed = render({
      refreshError: 'Не удалось обновить SSI. Показаны последние данные.',
    });
    expect(failed.get('[data-testid="ssi-refresh-error"]').text()).toContain(
      'Показаны последние данные',
    );
    expect(failed.get('[data-testid="ssi-age"]').text()).toBe(capturedLabel(SNAPSHOT.capturedAt));
    expect(failed.get('[data-testid="pv-age"]').text()).toBe(
      capturedLabel(PV_HISTORY[0].capturedAt),
    );
  });

  it('shows confirmed likes for the day without the defensive budget', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const mem = new Map<string, unknown>([
      [
        'autopilot:state',
        {
          running: false,
          host: 'tab',
          day: today,
          ceiling: 10,
          used: 2,
          actionTimestamps: [],
          actionsSinceBreak: 0,
          manualStop: false,
          startedAt: `${today}T09:00:00.000Z`,
          runId: 'run-1',
          effectLedger: {
            version: 1,
            active: {},
            receipts: {
              a: {
                effectId: 'a',
                requestId: 'r1',
                descriptor: { kind: 'like', targetKey: 'p1' },
                reservedAt: `${today}T09:00:00.000Z`,
                settledAt: `${today}T09:01:00.000Z`,
                outcome: 'confirmed',
                accounting: 'applied',
              },
            },
          },
        },
      ],
    ]);
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        id: 'x',
        onMessage: { addListener() {}, removeListener() {} },
        sendMessage: async () => ({}),
      },
      tabs: { query: async () => [] },
      storage: {
        local: {
          get: async (key: string) => ({ [key]: mem.get(key) }),
          set: async () => {},
        },
      },
    };
    const wrapper = render();
    await flushPromises();
    const tally = wrapper.get('[data-testid="today-tally"]').text();
    expect(tally).toMatch(/1\s*Лайков/);
    expect(tally).not.toContain('/');
  });
});
