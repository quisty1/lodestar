import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { RunReport, StopReason } from '@lib/types';
import ReportsScreen from './ReportsScreen.vue';

const LABELS: Record<StopReason, string> = {
  completed: 'завершено',
  budget: 'дневной бюджет',
  risk: 'риск-стоп',
  manual: 'остановлено вручную',
  feed_exhausted: 'лента кончилась',
  interrupted: 'прервано',
  navigation_failed: 'страница не открылась',
  unsupported_dom: 'разметка LinkedIn не поддерживается',
  error: 'ошибка',
};

describe('ReportsScreen', () => {
  it('renders every terminal run reason', () => {
    const reports: RunReport[] = Object.keys(LABELS).map((reason) => ({
      id: reason,
      startedAt: '2026-08-11T10:00:00.000Z',
      endedAt: '2026-08-11T10:01:00.000Z',
      host: 'tab',
      stopReason: reason as StopReason,
      modules: [],
    }));

    const text = mount(ReportsScreen, { props: { reports } }).text();

    for (const label of Object.values(LABELS)) expect(text).toContain(label);
  });
});
