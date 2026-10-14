<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import type { LlmModel } from '@lib/llm/models';
import { filterModels } from '../lib/filterModels';
import { useListbox } from '../composables/useListbox';
const props = defineProps<{ models: LlmModel[]; modelValue?: string }>();
const emit = defineEmits<{ 'update:modelValue': [id: string] }>();
const uid = useId();
const query = ref('');
const selectedLabel = computed(() => {
  const model = props.models.find((m) => m.id === props.modelValue);
  return model?.label || model?.id || props.modelValue || '';
});
const shown = computed(() => filterModels(props.models, query.value, 10));
const { open, highlighted, show, close, onKey } = useListbox(
  () => shown.value.length,
  (index) => {
    pick(shown.value[index]);
  },
);
function pick(model: LlmModel) {
  emit('update:modelValue', model.id);
  close();
  query.value = '';
}
function input(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  show();
}
function focus() {
  query.value = '';
  show();
}
</script>
<template>
  <div class="combo">
    <input
      :value="open ? query : selectedLabel"
      placeholder="Найти модель…"
      aria-label="Модель"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="`${uid}-models`"
      :aria-activedescendant="open && highlighted >= 0 ? `${uid}-model-${highlighted}` : undefined"
      data-testid="model-search"
      @input="input"
      @focus="focus"
      @blur="close"
      @keydown="onKey"
    />
    <ul
      v-if="open && shown.length"
      :id="`${uid}-models`"
      class="combo-list"
      role="listbox"
      aria-label="Модели"
    >
      <li
        v-for="(model, index) in shown"
        :id="`${uid}-model-${index}`"
        :key="model.id"
        role="option"
        :aria-selected="model.id === modelValue"
        :class="{ on: model.id === modelValue, highlighted: highlighted === index }"
        data-testid="model-opt"
        @mousedown.prevent="pick(model)"
      >
        {{ model.label || model.id }}
      </li>
    </ul>
    <div v-else-if="open" class="combo-empty" role="status">Ничего не найдено</div>
  </div>
</template>
