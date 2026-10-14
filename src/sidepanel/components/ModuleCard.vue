<script setup lang="ts">
import type { ModuleState } from '@lib/types';
defineProps<{
  module: ModuleState;
  title: string;
  desc: string;
  limitLabel?: string;
  recommended?: string;
}>();
defineEmits<{ toggle: []; setLimit: [n: number] }>();
</script>
<template>
  <section class="mod" :class="{ active: module.available && module.enabled }">
    <div class="mod-head">
      <div class="mic"><slot name="icon" /></div>
      <div class="mod-ttl">
        <h3>{{ title }}</h3>
        <p>{{ desc }}</p>
      </div>
      <span v-if="!module.available" class="hint">Недоступен</span>
      <button
        v-else
        class="sw"
        :class="{ on: module.enabled }"
        role="switch"
        :aria-checked="module.enabled"
        :aria-label="title"
        :data-testid="`toggle-${module.id}`"
        @click="$emit('toggle')"
      />
    </div>
    <label v-if="limitLabel" class="mod-limit">
      <span
        >{{ limitLabel }}<small v-if="recommended" class="hint"> ({{ recommended }})</small></span
      >
      <input
        type="number"
        min="1"
        :value="module.dailyLimit"
        :disabled="!module.available"
        :data-testid="`limit-${module.id}`"
        @change="$emit('setLimit', Number(($event.target as HTMLInputElement).value))"
      />
    </label>
    <details v-if="$slots.default">
      <summary>Параметры</summary>
      <slot />
    </details>
  </section>
</template>
