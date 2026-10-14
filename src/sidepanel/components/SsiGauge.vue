<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ score: number }>();
const value = computed(() =>
  Number.isFinite(props.score) ? Math.round(Math.min(100, Math.max(0, props.score))) : 0,
);
</script>
<template>
  <div class="score-value" aria-label="SSI">
    <span class="num" data-testid="gauge-num">{{ value }}</span
    ><span class="of">из 100</span>
  </div>
</template>
