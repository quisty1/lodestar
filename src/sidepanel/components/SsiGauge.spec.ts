import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SsiGauge from './SsiGauge.vue';
describe('numeric SSI', () => {
  it('shows the actual score immediately without animation', async () => {
    const w = mount(SsiGauge, { props: { score: 73 } });
    expect(w.get('[data-testid="gauge-num"]').text()).toBe('73');
    expect(w.find('svg').exists()).toBe(false);
    await w.setProps({ score: 64 });
    expect(w.get('[data-testid="gauge-num"]').text()).toBe('64');
  });
  it.each([
    [-1, '0'],
    [200, '100'],
    [NaN, '0'],
  ])('bounds a malformed score %s', (score, expected) => {
    expect(mount(SsiGauge, { props: { score } }).get('[data-testid="gauge-num"]').text()).toBe(
      expected,
    );
  });
});
