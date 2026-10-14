import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { SsiSnapshot } from '@lib/types';
import SsiTrend from './SsiTrend.vue';

describe('SsiTrend', () => {
  it('shows an empty state until two days exist', () => {
    const wrapper = mount(SsiTrend, { props: { history: [] } });
    expect(wrapper.get('[data-testid="trend-empty"]').text()).toContain('2 дня');
  });

  it('shows the latest total and the delta', () => {
    const wrapper = mount(SsiTrend, {
      props: {
        history: [snap(70, '2026-10-07T00:00:00.000Z'), snap(75, '2026-10-08T00:00:00.000Z')],
      },
    });
    expect(wrapper.get('[data-testid="trend-to"]').text()).toBe('75');
    expect(wrapper.get('[data-testid="trend-total-delta"]').text()).toContain('+5');
  });
});

function snap(total: number, capturedAt: string): SsiSnapshot {
  const score = total / 4;
  return {
    total,
    capturedAt,
    pillars: [
      { key: 'brand', label: 'Brand', score },
      { key: 'people', label: 'People', score },
      { key: 'insights', label: 'Insights', score },
      { key: 'relationships', label: 'Relationships', score },
    ],
  };
}
