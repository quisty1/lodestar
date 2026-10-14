import { ref } from 'vue';
export type ViewId =
  'v-dash' | 'v-auto' | 'v-inbox' | 'v-reports' | 'v-content' | 'v-settings' | 'v-profile';
export interface NavItem {
  id: ViewId;
  label: string;
}
export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'v-dash', label: 'Обзор' },
  { id: 'v-inbox', label: 'Входящие' },
  { id: 'v-content', label: 'Контент' },
  { id: 'v-reports', label: 'История' },
];
export function useNavigation(initial: ViewId = 'v-dash') {
  const active = ref<ViewId>(initial);
  const primary = ref<ViewId>(NAV_ITEMS.some((item) => item.id === initial) ? initial : 'v-dash');
  const history: ViewId[] = [];
  function go(id: ViewId) {
    if (id === active.value) return;
    if (NAV_ITEMS.some((item) => item.id === id)) {
      history.length = 0;
      primary.value = id;
    } else history.push(active.value);
    active.value = id;
  }
  function back() {
    active.value = history.pop() ?? primary.value;
  }
  return { active, primary, go, back, items: NAV_ITEMS };
}
