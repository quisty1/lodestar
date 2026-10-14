import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, useNavigation } from './useNavigation';

describe('panel navigation', () => {
  it('offers four daily destinations, with automation outside the bottom bar', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Обзор',
      'Входящие',
      'Контент',
      'История',
    ]);
    expect(NAV_ITEMS.some((item) => item.id === 'v-auto')).toBe(false);
  });

  it('returns from nested settings to its previous screen', () => {
    const nav = useNavigation('v-content');
    nav.go('v-settings');
    expect(nav.active.value).toBe('v-settings');
    expect(nav).toHaveProperty('back');
    Reflect.get(nav, 'back')();
    expect(nav.active.value).toBe('v-content');
  });

  it('returns through nested screens without changing the primary destination', () => {
    const nav = useNavigation('v-inbox');
    nav.go('v-auto');
    nav.go('v-settings');
    expect(nav).toHaveProperty('primary');
    expect(Reflect.get(nav, 'primary').value).toBe('v-inbox');
    Reflect.get(nav, 'back')();
    expect(nav.active.value).toBe('v-auto');
    nav.go('v-content');
    Reflect.get(nav, 'back')();
    expect(nav.active.value).toBe('v-content');
  });
});
