<script setup lang="ts">
import type { PillarView } from '../lib/ssiView';
defineProps<{ pillar: PillarView }>();
</script>
<template>
  <div class="pillar">
    <div class="ph">
      <span>{{ pillar.label }}</span
      ><span>{{ pillar.score }}</span>
    </div>
    <div
      class="track"
      role="meter"
      :aria-label="pillar.label"
      :aria-valuenow="pillar.pct / 4"
      :aria-valuemin="0"
      :aria-valuemax="25"
    >
      <div class="fill" :style="{ width: pillar.pct + '%' }" />
    </div>
  </div>
</template>
