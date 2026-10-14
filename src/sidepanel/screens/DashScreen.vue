<script setup lang="ts">
import { computed, onMounted, onActivated, ref } from 'vue';
import type { ModuleId, ProfileViewsSnapshot, SsiSnapshot } from '@lib/types';
import type { PillarView } from '../lib/ssiView';
import { weeklyGoal } from '@lib/ssi/weeklyGoal';
import { weeklyMinimum } from '@lib/ssi/weeklyMinimum';
import { windowedDelta } from '@lib/ssi/ssiProgress';
import { deltaArrow, deltaLabel } from '../lib/ssiTrendView';
import { readinessItems } from '@lib/autopilot/readiness';
import { COMMENT_JOURNAL_KEY, commentsInWeek } from '@lib/engagement/commentJournal';
import type { CommentJournalEntry } from '@lib/engagement/commentJournal';
import { isoWeekKey, POST_WEEK_BUDGET_KEY, type PostWeek } from '@lib/content/PostWeekBudget';
import { loadConnectSettings } from '@lib/connect/settings';
import { loadContentSettings } from '@lib/content/settings';
import { loadSettings } from '@lib/engagement/settings';
import { asArray } from '@lib/engagement/settings';
import { loadLlmConfig } from '@lib/llm/config';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import { panelBus } from '../lib/panelBus';
import SsiGauge from '../components/SsiGauge.vue';
import PillarBar from '../components/PillarBar.vue';
import SsiTrend from '../components/SsiTrend.vue';
import ProfileViewsTrend from '../components/ProfileViewsTrend.vue';
import { useDayStats } from '../composables/useDayStats';
import { useRunPause } from '../composables/useRunPause';
import { capturedLabel } from '../lib/capturedLabel';

const props = defineProps<{
  snapshot: SsiSnapshot | null;
  pillars: PillarView[];
  total: number;
  history: SsiSnapshot[];
  pvHistory: ProfileViewsSnapshot[];
  pvIsReal: boolean;
  isReal: boolean;
  refreshing: boolean;
  refreshError?: string | null;
  autopilotRunning?: boolean;
  /** Live run step label ("Добавляю в сеть…") — broadcast by the SW. */
  autopilotStage?: string | null;
  startHint?: string | null;
  autopilotPending?: 'starting' | 'stopping' | null;
  enabledModuleIds?: ModuleId[];
}>();

const { stats, reload: reloadStats } = useDayStats();
const tally = computed(() => [
  { label: 'Просмотрено', ...stats.value.views },
  { label: 'Приглашений', ...stats.value.connects },
  { label: 'Лайков', ...stats.value.likes },
  { label: 'Комментариев', ...stats.value.comments },
  { label: 'Идей', ...stats.value.ideas },
  { label: 'Публикаций', ...stats.value.posts },
]);
const ssiAge = computed(() => capturedLabel(props.snapshot?.capturedAt));
const profileAge = computed(() => capturedLabel(props.pvHistory.at(-1)?.capturedAt));
const emit = defineEmits<{
  refresh: [];
  startAutopilot: [];
  stopAutopilot: [];
  openAudit: [];
  openModules: [];
  openSettings: [];
  openInbox: [];
}>();

const { paused, pauseTomorrow, resume, reload: reloadPause } = useRunPause();
const pauseError = ref('');
const weekPosts = ref(0);
const weekComments = ref(0);
const checklist = ref(
  readinessItems({
    modulesOn: true,
    hasKeywords: true,
    hasExpertise: true,
    llmRequired: false,
    hasLlmKey: true,
    linkedInTab: null,
    paused: false,
  }),
);

const floor = computed(() =>
  weeklyMinimum({
    posts: weekPosts.value,
    comments: weekComments.value,
    reactions: stats.value.likes.budget,
  }),
);
async function loadPulse() {
  if (!panelBus.available()) return;
  try {
    const store = new ChromeStorageStore();
    const [postWeek, journal, connect, content, engagement, llm] = await Promise.all([
      store.get<PostWeek>(POST_WEEK_BUDGET_KEY),
      store.get(COMMENT_JOURNAL_KEY),
      loadConnectSettings(store),
      loadContentSettings(store),
      loadSettings(store),
      loadLlmConfig(store),
    ]);
    const week = isoWeekKey(new Date());
    weekPosts.value = postWeek?.week === week ? postWeek.used : 0;
    weekComments.value = commentsInWeek(asArray<CommentJournalEntry>(journal), week);
    const llmRequired =
      (props.enabledModuleIds ?? []).includes('content') || content.commentsEnabled;
    let linkedInTab: boolean | null = null;
    try {
      const tabs = await chrome.tabs.query({
        url: 'https://www.linkedin.com/*',
      });
      linkedInTab = tabs.length > 0;
    } catch {
      linkedInTab = null;
    }
    checklist.value = readinessItems({
      modulesOn: (props.enabledModuleIds ?? []).length > 0,
      hasKeywords: connect.searchKeywords.trim().length > 0,
      hasExpertise:
        engagement.expertise.headline.trim().length > 0 || engagement.expertise.stack.length > 0,
      llmRequired,
      hasLlmKey: llm.apiKey.trim().length > 0,
      linkedInTab,
      paused: paused.value,
    });
  } catch {
    return;
  }
}

onMounted(() => {
  void loadPulse();
});
onActivated(async () => {
  try {
    await reloadPause();
    await Promise.all([loadPulse(), reloadStats()]);
  } catch {
    pauseError.value = 'Не удалось обновить состояние. Откройте панель ещё раз.';
  }
});

async function onPause() {
  pauseError.value = '';
  try {
    if (paused.value) await resume();
    else {
      await pauseTomorrow();
      if (props.autopilotRunning) emit('stopAutopilot');
    }
    await loadPulse();
  } catch {
    pauseError.value = 'Не удалось сохранить паузу. Попробуйте ещё раз.';
  }
}

function onLaunch() {
  if (props.autopilotPending) return;
  if (props.autopilotRunning) emit('stopAutopilot');
  else emit('startAutopilot');
}

const chip = computed(() => {
  if (!props.snapshot) return '';
  const parts: string[] = [];
  if (props.snapshot.industryRank) parts.push(`${props.snapshot.industryRank} в индустрии`);
  if (props.snapshot.networkRank) parts.push(`${props.snapshot.networkRank} в твоей сети`);
  return parts.join(', ');
});

const goal = computed(() =>
  props.isReal && props.snapshot
    ? weeklyGoal(props.snapshot.pillars, props.enabledModuleIds)
    : null,
);

const recentDelta = computed(() => windowedDelta(props.history, 14));
const recentSpan = computed(() => {
  const d = recentDelta.value?.days ?? 0;
  return d === 1 ? 'за 1 день' : `за ${d} ${d < 5 ? 'дня' : 'дней'}`;
});
</script>

<template>
  <section id="v-dash" class="view">
    <div class="page-heading"><h1 tabindex="-1">Обзор</h1></div>
    <section class="run-panel" aria-label="Управление автоматизацией">
      <div class="run-heading">
        <h2>Автоматизация</h2>
        <span
          class="status"
          :class="{ idle: !autopilotRunning }"
          data-testid="ap-running"
          aria-live="polite"
          >{{
            autopilotRunning
              ? autopilotStage || 'Запускаюсь…'
              : paused
                ? 'На паузе до завтра'
                : 'Не запущен'
          }}</span
        >
      </div>
      <p class="run-description">Выполняет включённые модули в открытой вкладке LinkedIn.</p>
      <div class="run-actions">
        <button
          :class="autopilotRunning ? 'btn stop launch' : 'btn primary launch'"
          data-testid="ap-launch"
          :disabled="Boolean(autopilotPending)"
          @click="onLaunch"
        >
          {{
            autopilotPending === 'starting'
              ? 'Запускаю…'
              : autopilotPending === 'stopping'
                ? 'Останавливаю…'
                : autopilotRunning
                  ? 'Остановить'
                  : 'Запустить'
          }}
        </button>
        <button class="btn" data-testid="pause-until" @click="onPause">
          {{ paused ? 'Снять паузу' : 'Пауза до завтра' }}
        </button>
      </div>
      <div class="run-footer">
        <button class="text-button" data-testid="open-modules" @click="emit('openModules')">
          Настроить автоматизацию
        </button>
      </div>
      <div v-if="startHint" class="banner error" data-testid="ap-runtime-hint" role="status">
        <span data-testid="ap-no-modules">{{ startHint }}</span>
      </div>
      <p v-if="pauseError" class="banner error" role="alert">
        {{ pauseError }}
      </p>
      <div v-if="checklist.some((item) => !item.ok)" class="banner" data-testid="readiness">
        <div v-for="item in checklist.filter((item) => !item.ok)" :key="item.id">
          <button
            v-if="item.id === 'modules' || item.id === 'keywords'"
            class="text-button"
            @click="emit('openModules')"
          >
            {{ item.id === 'modules' ? 'Включите модуль автоматизации' : 'Укажите, кого искать' }}
          </button>
          <button
            v-else-if="item.id === 'expertise' || item.id === 'llm'"
            class="text-button"
            @click="emit('openSettings')"
          >
            {{ item.id === 'llm' ? 'Добавьте API-ключ' : 'Заполните экспертизу для текстов' }}
          </button>
          <a
            v-else-if="item.id === 'linkedin'"
            href="https://www.linkedin.com/feed/"
            target="_blank"
            rel="noopener"
            >Откройте LinkedIn</a
          >
        </div>
      </div>
    </section>
    <section class="section">
      <h2 class="section-heading">Сегодня</h2>
      <div class="ap-tally" data-testid="today-tally">
        <div
          v-for="m in tally"
          :key="m.label"
          class="ap-metric"
          :class="{ zero: m.confirmed === 0 }"
        >
          <span class="ap-num">{{ m.confirmed }}</span
          ><span class="ap-mlbl">{{ m.label }}</span>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="section-heading">
        <h2>Интерес к профилю</h2>
        <button class="text-button" @click="emit('openInbox')">Входящие</button>
      </div>
      <p v-if="profileAge" class="hint" data-testid="pv-age">
        {{ profileAge }}
      </p>
      <ProfileViewsTrend :history="pvHistory" :is-real="pvIsReal" />
    </section>
    <section class="section">
      <div class="section-heading">
        <h2>SSI</h2>
        <button
          class="ghost"
          data-testid="refresh-ssi"
          :disabled="refreshing"
          @click="emit('refresh')"
        >
          {{ refreshing ? 'Обновляю SSI…' : 'Обновить SSI' }}
        </button>
      </div>
      <div v-if="snapshot" class="ssi">
        <div class="ssi-top">
          <SsiGauge :score="total" />
          <div class="ssi-meta">
            <div
              v-if="recentDelta"
              class="delta"
              :class="{
                down: recentDelta.delta < 0,
                flat: recentDelta.delta === 0,
              }"
              data-testid="gauge-delta"
            >
              {{ deltaArrow(recentDelta.delta) }}
              {{ deltaLabel(recentDelta.delta) }} {{ recentSpan }}
            </div>
            <p v-if="ssiAge" class="hint" data-testid="ssi-age">{{ ssiAge }}</p>
            <p v-if="chip" class="hint">{{ chip }}</p>
          </div>
        </div>
        <div class="pillars">
          <PillarBar v-for="p in pillars" :key="p.key" :pillar="p" />
        </div>
      </div>
      <p v-else class="banner" data-testid="ssi-empty">
        Индекса ещё нет. Откройте LinkedIn и нажмите «Обновить SSI».
      </p>
      <p v-if="refreshError" class="banner error" data-testid="ssi-refresh-error" role="status">
        {{ refreshError }}
      </p>
      <details>
        <summary>Динамика SSI</summary>
        <SsiTrend :history="history" />
      </details>
    </section>
    <section class="section">
      <h2 class="section-heading">На этой неделе</h2>
      <p class="hint" data-testid="weekly-floor">
        {{ floor.done }} из {{ floor.total }}: публикация {{ floor.posts ? 'есть' : 'нужна' }},
        комментарий {{ floor.comments ? 'есть' : 'нужен' }}, реакция сегодня
        {{ floor.reactions ? 'есть' : 'нужна' }}.
      </p>
      <div v-if="goal" class="banner" data-testid="weekly-goal">
        {{ goal.message }} Цель: {{ goal.target }}/25.<button
          v-if="!goal.leverEnabled"
          class="text-button"
          data-testid="open-lever"
          @click="emit('openModules')"
        >
          Включить модуль
        </button>
      </div>
      <button class="ghost" data-testid="open-audit" @click="emit('openAudit')">
        Аудит профиля
      </button>
    </section>
  </section>
</template>
