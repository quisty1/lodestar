<script setup lang="ts">
import { computed } from 'vue';
import type { ProfileViewsSnapshot } from '@lib/types';
import { computeViewsProgress } from '@lib/profileViews/profileViewsProgress';
// Generic trend-view helpers (shared with SsiTrend).
import {
  sparklinePoints,
  deltaArrow,
  deltaLabel,
  spanLabel as spanLabelFor,
  daysLabel,
} from '../lib/ssiTrendView';

// `isReal` is false until the first profile-views snapshot. Hide the count then.
const props = withDefaults(defineProps<{ history: ProfileViewsSnapshot[]; isReal?: boolean }>(), {
  isReal: true,
});

const W = 240;
const H = 30;

const progress = computed(() => computeViewsProgress(props.history));

// Auto-scale the sparkline to the data (views have no fixed ceiling like SSI's 25).
const points = computed(() =>
  sparklinePoints(progress.value.values, W, H, Math.max(...progress.value.values, 1)),
);

const arrow = computed(() => deltaArrow(progress.value.countDelta));
const deltaTxt = computed(() => deltaLabel(progress.value.countDelta));
// Honesty: this is a ROLLING window — a dip is often just old views ageing out,
// not a real decline. So growth reads positive, but a drop stays NEUTRAL (never
// an alarming red), unlike SSI where down genuinely means the score fell.
const deltaCls = computed(() => (progress.value.countDelta > 0 ? 'up' : 'flat'));

const spanLabel = computed(() => spanLabelFor(progress.value.spanDays));
const windowLabel = computed(() => `за ${daysLabel(progress.value.windowDays)}`);
</script>

<template>
  <div class="pv" data-testid="pv-trend">
    <div v-if="!isReal" class="pv-cap" data-testid="pv-cap">
      Снимка ещё нет. Просмотры появятся после обновления.
    </div>
    <template v-else>
      <div class="pv-head">
        <div class="pv-count">
          <span class="pv-num" data-testid="pv-count">{{ progress.countTo }}</span>
          <span class="pv-unit">просмотров профиля {{ windowLabel }}</span>
        </div>
        <div v-if="progress.hasBaseline" class="delta" :class="deltaCls" data-testid="pv-delta">
          {{ arrow }} {{ deltaTxt }}
          <span class="span">{{ spanLabel }}</span>
        </div>
      </div>

      <!-- Trend needs ≥2 daily snapshots; the count above is useful from day one. -->
      <svg
        v-if="progress.hasBaseline"
        class="spark"
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="none"
        aria-hidden="true"
        data-testid="pv-spark"
      >
        <polyline
          :points="points"
          stroke="var(--accent)"
          fill="none"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      </svg>
      <div v-else class="pv-hint" data-testid="pv-hint">
        Динамика появится, когда накопится <b>2 дня</b> данных.
      </div>

      <div class="pv-cap" data-testid="pv-cap">Скользящее окно LinkedIn</div>
    </template>
  </div>
</template>
