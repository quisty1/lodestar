<script setup lang="ts">
import { ref, onMounted, onActivated } from 'vue';
import type { RunReport } from '@lib/types';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import { CONNECT_HISTORY_KEY, type ConnectRecord } from '@lib/connect/ConnectHistory';
import { VIEW_HISTORY_KEY, type ViewRecord } from '@lib/views/ViewHistory';
import { asArray } from '@lib/engagement/settings';
import { moduleLabel, reasonHint } from '@lib/autopilot/reasonLabels';
import { COMMENT_JOURNAL_KEY, type CommentJournalEntry } from '@lib/engagement/commentJournal';
import { loadConnectSettings } from '@lib/connect/settings';
import { loadSettings } from '@lib/engagement/settings';
import { connectNoteText, noteMonthKey, notesRemaining } from '@lib/connect/notes';
import PanelTabs from '../components/PanelTabs.vue';
import { panelBus } from '../lib/panelBus';

defineProps<{ reports: RunReport[] }>();

const REASON: Record<RunReport['stopReason'], string> = {
  completed: 'завершено',
  budget: 'дневной бюджет',
  risk: 'риск-стоп',
  manual: 'остановлено вручную',
  feed_exhausted: 'лента кончилась',
  interrupted: 'прервано',
  navigation_failed: 'страница не открылась',
  unsupported_dom: 'разметка LinkedIn не поддерживается',
  error: 'ошибка',
};
const fmt = (iso: string) => new Date(iso).toLocaleString();

// Detailed connect history (who was added + when) — read straight from storage.
const connects = ref<ConnectRecord[]>([]);
const views = ref<ViewRecord[]>([]);
const comments = ref<CommentJournalEntry[]>([]);
const noteCap = ref(0);
const expertiseLine = ref('');
const keywords = ref('');
const notesUsed = ref(0);
const tab = ref('runs');
const tabs = [
  { id: 'runs', label: 'Прогоны' },
  { id: 'contacts', label: 'Контакты' },
  { id: 'comments', label: 'Комментарии' },
  { id: 'views', label: 'Просмотры' },
];
const loadError = ref('');
const loading = ref(false);
async function loadHistory() {
  if (!panelBus.available() || loading.value) return;
  loading.value = true;
  loadError.value = '';
  try {
    const store = new ChromeStorageStore();
    connects.value = asArray<ConnectRecord>(await store.get(CONNECT_HISTORY_KEY));
    views.value = asArray<ViewRecord>(await store.get(VIEW_HISTORY_KEY));
    comments.value = asArray<CommentJournalEntry>(await store.get(COMMENT_JOURNAL_KEY));
    const [connect, engagement] = await Promise.all([
      loadConnectSettings(store),
      loadSettings(store),
    ]);
    noteCap.value = connect.notesPerMonth;
    keywords.value = connect.searchKeywords;
    expertiseLine.value = engagement.expertise.headline;
    const month = noteMonthKey(new Date());
    notesUsed.value = Number(await store.get(`connect:notes:${month}`)) || 0;
  } catch {
    loadError.value = 'Не удалось загрузить историю. Попробуйте ещё раз.';
  } finally {
    loading.value = false;
  }
}
onMounted(loadHistory);
onActivated(loadHistory);

async function copyNote(person: ConnectRecord) {
  if (notesRemaining(notesUsed.value, noteCap.value) <= 0) return;
  const text = connectNoteText({
    name: person.name,
    headline: person.headline,
    expertise: expertiseLine.value,
    keywords: keywords.value,
  });
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* the text is still shown via the prompt below */
  }
  const store = new ChromeStorageStore();
  const month = noteMonthKey(new Date());
  notesUsed.value += 1;
  await store.set(`connect:notes:${month}`, notesUsed.value);
  window.prompt('Заметка для ручной отправки. Инвайт Lodestar по-прежнему уходит без текста.', text);
}
</script>

<template>
  <section id="v-reports" class="view">
    <div class="page-heading"><h1 tabindex="-1">История</h1></div>
    <PanelTabs v-model="tab" :items="tabs" label="Виды истории" wrap>
      <p v-if="loading" class="hint" role="status">Загружаю историю…</p>
      <p v-if="loadError" class="banner error" role="alert">
        {{ loadError }} <button class="text-button" @click="loadHistory">Повторить</button>
      </p>
      <template v-if="tab === 'runs'">
        <p v-if="!reports.length" class="empty">
          <strong>Прогонов пока нет</strong>Запустите автоматизацию в разделе «Обзор».
        </p>
        <details v-for="r in reports" :key="r.id" :data-testid="`report-${r.id}`">
          <summary>
            {{ fmt(r.startedAt) }}<span class="hint"> — {{ REASON[r.stopReason] }}</span>
          </summary>
          <div v-for="m in r.modules" :key="m.id" class="list-row">
            {{ moduleLabel(m.id) }}: <b>{{ m.executed }}</b>
            <p v-if="reasonHint(m.reason)" class="hint">{{ reasonHint(m.reason) }}</p>
          </div>
        </details>
      </template>
      <template v-else-if="tab === 'contacts'">
        <p v-if="!loading && !loadError && !connects.length" class="empty">
          <strong>Приглашений пока нет</strong>Здесь появятся люди, которым Lodestar отправил
          приглашения.
        </p>
        <article
          v-for="c in connects"
          :key="c.memberId + c.sentAt"
          class="list-row"
          data-testid="connect-record"
        >
          <a :href="c.profileUrl" target="_blank" rel="noopener"
            ><b>{{ c.name }}</b></a
          >
          <p v-if="c.headline" class="hint">{{ c.headline }}</p>
          <p class="hint">{{ fmt(c.sentAt) }}</p>
          <button
            v-if="noteCap > 0"
            class="ghost"
            :disabled="notesRemaining(notesUsed, noteCap) <= 0"
            @click="copyNote(c)"
          >
            Подготовить заметку ({{ notesRemaining(notesUsed, noteCap) }}/{{ noteCap }})
          </button>
        </article>
      </template>
      <template v-else-if="tab === 'comments'">
        <p v-if="!loading && !loadError && !comments.length" class="empty">
          <strong>Комментариев пока нет</strong>Здесь появятся тексты, опубликованные от вашего
          имени.
        </p>
        <article v-for="comment in comments" :key="comment.id" class="list-row">
          <p class="hint">{{ fmt(comment.at) }}, {{ comment.author }}</p>
          <p>{{ comment.text }}</p>
        </article>
      </template>
      <template v-else>
        <p v-if="!loading && !loadError && !views.length" class="empty">
          <strong>Просмотров пока нет</strong>Здесь появятся посещённые профили.
        </p>
        <article
          v-for="v in views"
          :key="v.memberId + v.viewedAt"
          class="list-row"
          data-testid="view-record"
        >
          <a :href="v.profileUrl" target="_blank" rel="noopener"
            ><b>{{ v.name }}</b></a
          >
          <p v-if="v.headline" class="hint">{{ v.headline }}</p>
          <p class="hint">{{ fmt(v.viewedAt) }}</p>
        </article>
      </template>
    </PanelTabs>
  </section>
</template>
