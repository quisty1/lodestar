<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { COUNTRIES, countryFlag, countryNameRu, filterCountries } from '@lib/connect/regions';
import { useListbox } from '../composables/useListbox';
const props = defineProps<{ modelValue: string[]; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [isos: string[]] }>();
const uid = useId();
const query = ref('');
const allSelected = computed(() => props.modelValue.length === COUNTRIES.length);
const shown = computed(() => filterCountries(query.value));
const selected = computed(() =>
  [...props.modelValue].sort((a, b) => countryNameRu(a).localeCompare(countryNameRu(b), 'ru')),
);
const { open, highlighted, show, close, onKey } = useListbox(
  () => shown.value.length,
  (index) => {
    toggle(shown.value[index].iso);
  },
);
function input(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  show();
}
function toggle(iso: string) {
  emit(
    'update:modelValue',
    props.modelValue.includes(iso)
      ? props.modelValue.filter((code) => code !== iso)
      : [...props.modelValue, iso],
  );
}
function remove(iso: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((code) => code !== iso),
  );
}
</script>
<template>
  <div class="combo">
    <div class="combo-field">
      <input
        :value="query"
        :disabled="disabled"
        placeholder="Найти страну…"
        aria-label="Страны"
        data-testid="country-search"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="`${uid}-countries`"
        :aria-activedescendant="
          open && highlighted >= 0 ? `${uid}-country-${highlighted}` : undefined
        "
        @input="input"
        @focus="show"
        @blur="close"
        @keydown="onKey"
      />
      <ul
        v-if="open && shown.length"
        :id="`${uid}-countries`"
        class="combo-list"
        role="listbox"
        aria-label="Страны"
        aria-multiselectable="true"
      >
        <li
          v-for="(country, index) in shown"
          :id="`${uid}-country-${index}`"
          :key="country.iso"
          role="option"
          :aria-selected="modelValue.includes(country.iso)"
          :class="{
            on: modelValue.includes(country.iso),
            highlighted: highlighted === index,
          }"
          data-testid="country-opt"
          @mousedown.prevent="toggle(country.iso)"
        >
          <span class="flag" aria-hidden="true">{{ countryFlag(country.iso) }}</span>
          {{ countryNameRu(country.iso) }}
        </li>
      </ul>
      <div v-else-if="open" class="combo-empty" role="status">Ничего не найдено</div>
    </div>
    <p v-if="allSelected" class="hint" data-testid="countries-all">Все страны</p>
    <div v-else-if="selected.length" class="chips">
      <button
        v-for="iso in selected"
        :key="iso"
        type="button"
        class="chip"
        :disabled="disabled"
        :aria-label="`Убрать ${countryNameRu(iso)}`"
        @click="remove(iso)"
      >
        <span class="flag" aria-hidden="true">{{ countryFlag(iso) }}</span>
        {{ countryNameRu(iso) }}<span aria-hidden="true">×</span>
      </button>
    </div>
  </div>
</template>
