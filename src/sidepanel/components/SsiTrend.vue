<script setup lang="ts">
import { computed } from 'vue';
import type { SsiSnapshot, SsiPillarKey } from '@lib/types';
import { computeProgress, pillarSeries } from '@lib/ssi/ssiProgress';
import {
  sparklinePoints,
  deltaArrow,
  deltaLabel,
  spanLabel as spanLabelFor,
} from '../lib/ssiTrendView';

const props = defineProps<{ history: SsiSnapshot[] }>();

// Neutral accent for each pillar; labels identify the series.
const STROKE: Record<SsiPillarKey, string> = {
  brand: 'var(--accent)',
  people: 'var(--accent)',
  insights: 'var(--accent)',
  relationships: 'var(--accent)',
};

const W = 120;
const H = 26;

const progress = computed(() => computeProgress(props.history));
const series = computed(() => pillarSeries(props.history));

// Merge each pillar's baseline→now delta with its sparkline path.
const rows = computed(() =>
  series.value.map((s) => {
    const d = progress.value.pillars.find((p) => p.key === s.key);
    const delta = d?.delta ?? 0;
    return {
      key: s.key,
      label: s.label,
      points: sparklinePoints(s.values, W, H, 25),
      stroke: STROKE[s.key],
      delta,
      arrow: deltaArrow(delta),
      label_: deltaLabel(delta),
      cls: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    };
  }),
);

const totalArrow = computed(() => deltaArrow(progress.value.totalDelta));
const totalLabel = computed(() => deltaLabel(progress.value.totalDelta));
const totalCls = computed(() =>
  progress.value.totalDelta > 0 ? 'up' : progress.value.totalDelta < 0 ? 'down' : 'flat',
);
const spanLabel = computed(() => spanLabelFor(progress.value.spanDays));
</script>

<template>
  <!-- Not enough data yet: honest, no invented numbers. -->
  <div
    v-if="!progress.hasBaseline"
    class="banner"
    data-testid="trend-empty"
    style="color: var(--mut)"
  >
    Для динамики нужны снимки минимум за <b>2 дня</b>. SSI обновляется раз в сутки.
  </div>

  <div v-else class="trend" data-testid="ssi-trend">
    <!-- Overall: было → стало -->
    <div class="trend-head">
      <div class="wasnow">
        <span class="was" data-testid="trend-from">{{ progress.totalFrom }}</span>
        <span class="arrow">→</span>
        <span class="now" data-testid="trend-to">{{ progress.totalTo }}</span>
      </div>
      <div class="delta" :class="totalCls" data-testid="trend-total-delta">
        {{ totalArrow }} {{ totalLabel }}
        <span class="span">{{ spanLabel }}</span>
      </div>
    </div>

    <!-- Per-pillar sparklines -->
    <div class="rows">
      <div v-for="r in rows" :key="r.key" class="row" :data-testid="`trend-row-${r.key}`">
        <span class="rlbl">{{ r.label }}</span>
        <svg class="spark" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" aria-hidden="true">
          <polyline
            :points="r.points"
            :stroke="r.stroke"
            fill="none"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
        <span class="rdelta" :class="r.cls">{{ r.arrow }} {{ r.label_ }}</span>
      </div>
    </div>
  </div>
</template>
