import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ModelCombobox from './ModelCombobox.vue';
import CountryMultiSelect from './CountryMultiSelect.vue';

describe('keyboard selection', () => {
  it('selects a model using the keyboard and shows stored IDs without a catalog', async () => {
    const w = mount(ModelCombobox, {
      props: { models: [], modelValue: 'saved/model' },
    });
    expect((w.get('input').element as HTMLInputElement).value).toBe('saved/model');
    await w.setProps({ models: [{ id: 'new/model', label: 'Другая модель' }] });
    await w.get('input').trigger('focus');
    await w.get('input').trigger('keydown', { key: 'ArrowDown' });
    await w.get('input').trigger('keydown', { key: 'Enter' });
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['new/model']);
    expect(w.get('input').attributes('aria-expanded')).toBe('false');
  });

  it('adds a country using the keyboard, then closes with Escape', async () => {
    const w = mount(CountryMultiSelect, { props: { modelValue: [] } });
    await w.get('input').setValue('Грузия');
    const option = w.get('[data-testid="country-opt"]');
    expect(option.text()).toContain('🇬🇪');
    expect(option.get('.flag').attributes('aria-hidden')).toBe('true');
    await w.get('input').trigger('keydown', { key: 'ArrowDown' });
    await w.get('input').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(w.emitted('update:modelValue')?.[0]).toEqual([['GE']]);
    await w.get('input').trigger('keydown', { key: 'Escape' });
    expect(w.get('input').attributes('aria-expanded')).toBe('false');
    expect(w.get('input').attributes('aria-label')).toBe('Страны');
  });

  it('anchors the country list to the search field, outside the selected chips', async () => {
    const w = mount(CountryMultiSelect, {
      props: { modelValue: ['DE', 'SE'] },
    });
    await w.get('input').trigger('focus');
    const field = w.get('.combo-field').element;
    expect(field.contains(w.get('input').element)).toBe(true);
    expect(field.contains(w.get('.combo-list').element)).toBe(true);
    expect(field.contains(w.get('.chips').element)).toBe(false);
    const chips = w.findAll('.chip');
    expect(chips.map((chip) => chip.text())).toEqual([
      expect.stringContaining('🇩🇪'),
      expect.stringContaining('🇸🇪'),
    ]);
    expect(chips[0].attributes('aria-label')).toBe('Убрать Германия');
    expect(chips[1].attributes('aria-label')).toBe('Убрать Швеция');
  });
});
