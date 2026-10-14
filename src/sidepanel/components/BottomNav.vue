<script setup lang="ts">
import { NAV_ITEMS, type ViewId } from '../composables/useNavigation';
import Icon from './Icon.vue';
defineProps<{ active: ViewId }>();
defineEmits<{ go: [id: ViewId] }>();
const icons: Record<string, string> = {
  'v-dash': 'overview',
  'v-inbox': 'inbox',
  'v-content': 'content',
  'v-reports': 'history',
};
</script>
<template>
  <nav class="nav" aria-label="Основные разделы">
    <button
      v-for="item in NAV_ITEMS"
      :key="item.id"
      :class="{ on: active === item.id }"
      :aria-current="active === item.id ? 'page' : undefined"
      :data-testid="`nav-${item.id}`"
      @click="$emit('go', item.id)"
    >
      <Icon :name="icons[item.id]" /><span>{{ item.label }}</span>
    </button>
  </nav>
</template>
