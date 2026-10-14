<script setup lang="ts">
import { useId } from 'vue';
const props = defineProps<{
  modelValue: string;
  items: readonly { id: string; label: string }[];
  label: string;
  wrap?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const uid = useId();
function onKey(event: KeyboardEvent, index: number) {
  let next = index;
  if (event.key === 'ArrowRight') next = (index + 1) % props.items.length;
  else if (event.key === 'ArrowLeft') next = (index + props.items.length - 1) % props.items.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = props.items.length - 1;
  else return;
  event.preventDefault();
  emit('update:modelValue', props.items[next].id);
  (event.currentTarget as HTMLElement).parentElement
    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    [next]?.focus();
}
</script>
<template>
  <div class="tabs" :class="{ wrap }" role="tablist" :aria-label="label">
    <button
      v-for="(item, index) in items"
      :id="`${uid}-${item.id}`"
      :key="item.id"
      type="button"
      role="tab"
      :aria-selected="modelValue === item.id"
      :aria-controls="`${uid}-panel`"
      :tabindex="modelValue === item.id ? 0 : -1"
      :data-testid="`subtab-${item.id}`"
      @click="emit('update:modelValue', item.id)"
      @keydown="onKey($event, index)"
    >
      {{ item.label }}
    </button>
  </div>
  <div :id="`${uid}-panel`" role="tabpanel" :aria-labelledby="`${uid}-${modelValue}`"><slot /></div>
</template>
