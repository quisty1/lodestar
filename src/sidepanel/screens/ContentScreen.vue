<script setup lang="ts">
import { onMounted, onActivated, computed, ref } from 'vue';
import DraftEditor from '../components/DraftEditor.vue';
import PanelTabs from '../components/PanelTabs.vue';
import Icon from '../components/Icon.vue';
import { panelBus } from '../lib/panelBus';
import { useContent } from '../composables/useContent';

const {
  tab,
  ideas,
  drafts,
  generating,
  drafting,
  error,
  postsLeft,
  lastRun,
  loadIdeas,
  generateIdeas,
  removeIdea,
  toDraft,
  loadLastRun,
  loadDrafts,
  removeDraft,
  updateDraft,
  approveDraft,
  setMedia,
  setKind,
  loadPostBudget,
} = useContent();

const selectedId = ref<string | null>(null);
const selected = computed(() => drafts.value.find((d) => d.id === selectedId.value));
const editor = ref<{ beforeLeave: () => Promise<boolean> } | null>(null);
const loadError = ref('');
const loading = ref(panelBus.available());
const tabs = [
  { id: 'ideas', label: 'Идеи' },
  { id: 'drafts', label: 'Черновики' },
];
async function reloadContent() {
  loadError.value = '';
  if (!panelBus.available()) return;
  loading.value = true;
  try {
    await Promise.all([loadIdeas(), loadDrafts(), loadPostBudget(), loadLastRun()]);
  } catch {
    loadError.value = 'Не удалось загрузить контент. Попробуйте ещё раз.';
  } finally {
    loading.value = false;
  }
}
onMounted(reloadContent);
let activatedOnce = false;
onActivated(() => {
  if (activatedOnce) void reloadContent();
  activatedOnce = true;
});
async function beforeLeave() {
  return (await editor.value?.beforeLeave()) ?? true;
}
defineExpose({ beforeLeave });
async function createDraft(idea: Parameters<typeof toDraft>[0], key: string) {
  try {
    await toDraft(idea, key);
  } catch {
    loadError.value = 'Не удалось создать черновик. Попробуйте ещё раз.';
  }
}
async function regenerateDraft(idea: Parameters<typeof toDraft>[0], key: string) {
  await toDraft(idea, key);
  if (error.value) throw new Error(error.value);
}
async function collectIdeas() {
  try {
    await generateIdeas();
  } catch {
    loadError.value = 'Не удалось загрузить идеи. Попробуйте ещё раз.';
  }
}
async function deleteIdea(idea: Parameters<typeof removeIdea>[0]) {
  try {
    await removeIdea(idea);
  } catch {
    loadError.value = 'Не удалось удалить идею. Попробуйте ещё раз.';
  }
}

/** Human-readable status of the last AUTO idea-collect during a run (empty until one runs). */
const lastRunText = computed(() => {
  const r = lastRun.value;
  if (!r) return '';
  const t = new Date(r.at).toLocaleTimeString('ru', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (r.reason === 'ok') return `Последний автосбор: +${r.stored} идей (${t})`;
  if (r.reason === 'budget_exhausted')
    return `Бюджет идей на сегодня исчерпан (${r.budget?.used}/${r.budget?.limit}) — обновится завтра`;
  if (r.reason === 'error') return `Ошибка автосбора в прогоне: ${r.error} (${t})`;
  if (r.reason === 'no_feed') return `Автосбор: лента пуста на момент прогона (${t})`;
  if (r.reason === 'thin_feed')
    return `Маловато постов для идей в этом прогоне (${r.posts}) — соберётся в следующем (${t})`;
  if (r.reason === 'disabled') return `Контент-модуль был выключен в этом прогоне (${t})`;
  if (r.reason === 'no_key') return `Автосбор пропущен: не задан LLM-ключ (${t})`;
  if (r.reason === 'no_expertise')
    return `Автосбор пропущен: не заполнен профиль экспертизы (${t})`;
  const reason: string = r.reason;
  return `Автосбор: ${reason} (${t})`;
});

const ERR: Record<string, string> = {
  transport_unavailable: 'Не удалось получить ответ. Попробуйте ещё раз.',
  no_key: 'Задай LLM-ключ в настройках.',
  no_expertise: 'Заполни профиль экспертизы в настройках.',
  no_feed: 'Открой вкладку ленты LinkedIn.',
  ideas_not_json:
    'Модель вернула ответ не в том формате. Выбери модель посильнее — например openai/gpt-4o-mini или google/gemini-2.5-flash — и попробуй снова.',
};
</script>
<template>
  <section id="v-content" class="view">
    <div class="page-heading"><h1 tabindex="-1">Контент</h1></div>
    <DraftEditor
      v-if="selected"
      ref="editor"
      :key="selected.id"
      :draft="selected"
      :posts-left="postsLeft"
      :update-text="updateDraft"
      :approve="approveDraft"
      :set-media="setMedia"
      :set-kind="setKind"
      :remove="removeDraft"
      :regenerate="regenerateDraft"
      @close="selectedId = null"
    />
    <template v-else>
      <PanelTabs v-model="tab" :items="tabs" label="Контент">
        <p v-if="loading" class="hint" role="status">Загружаю контент…</p>
        <p v-if="error || loadError" class="banner error" role="alert">
          {{ loadError || ERR[error!] || `Ошибка: ${error}` }}
        </p>
        <template v-if="tab === 'ideas'">
          <button
            class="btn primary"
            :disabled="generating || loading"
            data-testid="gen-ideas"
            @click="collectIdeas"
          >
            {{ generating ? 'Собираю идеи…' : 'Сгенерировать идеи' }}
          </button>
          <p v-if="lastRunText" class="banner" data-testid="ideas-last-run">{{ lastRunText }}</p>
          <p v-if="!loading && !loadError && !ideas.length" class="empty">
            <strong>Идей пока нет</strong>Откройте ленту LinkedIn и сгенерируйте идеи для
            публикаций.
          </p>
          <article v-for="(idea, i) in ideas" :key="i" class="list-row" :data-testid="`idea-${i}`">
            <h3>{{ idea.topic }}</h3>
            <p class="description">{{ idea.angle }}</p>
            <details v-if="idea.spark">
              <summary>Источник идеи</summary>
              <p class="hint" :data-testid="`spark-${i}`">
                {{ idea.spark.claim
                }}<span v-if="idea.spark.source"> ({{ idea.spark.source.author }})</span>
              </p>
            </details>
            <div class="actions">
              <button
                class="btn"
                :data-testid="`to-draft-${i}`"
                :disabled="drafting === `idea-${i}`"
                @click="createDraft(idea, `idea-${i}`)"
              >
                {{ drafting === `idea-${i}` ? 'Создаю…' : 'Создать черновик' }}</button
              ><button class="ghost" @click="deleteIdea(idea)">Удалить</button>
            </div>
          </article>
        </template>
        <template v-else>
          <p v-if="drafts.length" class="hint" data-testid="posts-left">
            Осталось публикаций на неделе: {{ postsLeft }}
          </p>
          <p v-if="!loading && !loadError && !drafts.length" class="empty">
            <strong>Черновиков пока нет</strong>Выберите идею и нажмите «Создать черновик».
          </p>
          <article v-for="d in drafts" :key="d.id" class="list-row" :data-testid="`draft-${d.id}`">
            <button
              class="list-button"
              :data-testid="`open-draft-${d.id}`"
              @click="selectedId = d.id"
            >
              <span
                ><strong>{{ d.ideaTopic }}</strong
                ><span class="preview">{{ d.text }}</span
                ><span class="hint" :class="{ ok: d.approved }">{{
                  d.approved ? 'Одобрен для публикации' : 'Нужна проверка'
                }}</span></span
              ><Icon name="chevron" :size="16" />
            </button>
          </article>
        </template>
      </PanelTabs>
    </template>
  </section>
</template>
