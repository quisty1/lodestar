import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import ProfileViewsTrend from './ProfileViewsTrend.vue';
import type { ProfileViewsSnapshot } from '@lib/types';

const snap = (count: number, at: string): ProfileViewsSnapshot => ({
  count,
  windowDays: 90,
  capturedAt: at,
});

describe('ProfileViewsTrend', () => {
  it('shows the current count and window even with a single snapshot (no trend yet)', () => {
    const w = mount(ProfileViewsTrend, {
      props: { history: [snap(45, '2026-07-02T00:00:00Z')] },
    });
    expect(w.find('[data-testid="pv-count"]').text()).toBe('45');
    expect(w.text()).toMatch(/за 90 дней/);
    expect(w.find('[data-testid="pv-hint"]').exists()).toBe(true); // needs 2 days
    expect(w.find('[data-testid="pv-spark"]').exists()).toBe(false);
    expect(w.find('[data-testid="pv-delta"]').exists()).toBe(false);
  });

  it('renders the was→now trend + sparkline once there are ≥2 daily snapshots', () => {
    const w = mount(ProfileViewsTrend, {
      props: {
        history: [snap(40, '2026-06-28T00:00:00Z'), snap(45, '2026-07-02T00:00:00Z')],
      },
    });
    expect(w.find('[data-testid="pv-count"]').text()).toBe('45');
    expect(w.find('[data-testid="pv-spark"]').exists()).toBe(true);
    expect(w.find('[data-testid="pv-delta"]').text()).toMatch(/▲ \+5/);
    expect(w.find('[data-testid="pv-delta"]').classes()).toContain('up');
  });

  it('hides the count until a real snapshot exists', () => {
    const hist = [snap(28, '2026-06-09T00:00:00Z'), snap(45, '2026-07-02T00:00:00Z')];
    const real = mount(ProfileViewsTrend, {
      props: { history: hist, isReal: true },
    });
    expect(real.find('[data-testid="pv-count"]').text()).toBe('45');
    expect(real.find('[data-testid="pv-cap"]').text()).toMatch(/Скользящее окно LinkedIn/);

    const missing = mount(ProfileViewsTrend, {
      props: { history: [], isReal: false },
    });
    expect(missing.find('[data-testid="pv-count"]').exists()).toBe(false);
    expect(missing.find('[data-testid="pv-cap"]').text()).toMatch(/Снимка ещё нет/);
  });

  it('HONESTY: a rolling-window dip stays NEUTRAL, never an alarming red', () => {
    const w = mount(ProfileViewsTrend, {
      props: {
        history: [snap(50, '2026-06-28T00:00:00Z'), snap(45, '2026-07-02T00:00:00Z')],
      },
    });
    const delta = w.find('[data-testid="pv-delta"]');
    expect(delta.text()).toMatch(/▼ −5/);
    // must be the neutral class — NOT 'up' and NOT any down/alarm class
    expect(delta.classes()).toContain('flat');
    expect(delta.classes()).not.toContain('up');
    expect(delta.classes()).not.toContain('down');
  });
});
