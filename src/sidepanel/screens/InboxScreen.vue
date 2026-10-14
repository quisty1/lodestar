<script setup lang="ts">
import { computed, ref, onActivated } from 'vue';
import type { ProfileViewsSnapshot } from '@lib/types';
import PanelTabs from '../components/PanelTabs.vue';
import { useInbox } from '../composables/useInbox';
import { capturedLabel } from '../lib/capturedLabel';

const props = defineProps<{
  pvHistory: ProfileViewsSnapshot[];
  pvIsReal: boolean;
}>();
const { snapshot, views, rate, loading, refreshing, refreshError, refresh, load } = useInbox(
  () => props.pvHistory,
);

const tab = ref('viewers');
const tabs = [
  { id: 'viewers', label: 'Просмотры' },
  { id: 'messages', label: 'Сообщения' },
  { id: 'accepted', label: 'Принятые' },
];
onActivated(() => {
  void load();
});
const shown = computed(() =>
  !snapshot.value
    ? []
    : tab.value === 'messages'
      ? snapshot.value.messages
      : tab.value === 'accepted'
        ? snapshot.value.accepted
        : snapshot.value.viewers,
);
const listStatus = computed(() =>
  !snapshot.value
    ? undefined
    : tab.value === 'messages'
      ? snapshot.value.messagesStatus
      : tab.value === 'accepted'
        ? snapshot.value.acceptedStatus
        : snapshot.value.viewersStatus,
);

const viewLine = computed(() => {
  if (!props.pvIsReal || !views.value.to) return 'Просмотры профиля ещё не сняты.';
  if (!views.value.hasBaseline)
    return `Сейчас ${views.value.countTo} за ${views.value.windowDays} дней. Сравнить будет с чем после следующего снимка.`;
  const delta = views.value.countDelta;
  const sign = delta > 0 ? `+${delta}` : String(delta);
  return `${views.value.countFrom} → ${views.value.countTo} (${sign}) за ${views.value.windowDays} дней. Это скользящее окно LinkedIn.`;
});

const acceptLine = computed(() => {
  const value = rate.value;
  if (value.accepted === null) {
    return value.sent
      ? `За ${value.windowDays} дней отправлено ${value.sent}. Принятие ещё не проверено.`
      : 'Принятых инвайтов пока нет: исходящих за последние недели тоже нет.';
  }
  if (!value.sent) return 'За последние недели исходящих инвайтов нет.';
  const pct = value.rate === null ? '—' : `${Math.round(value.rate * 100)}%`;
  return `Приняли ${value.accepted} из ${value.sent} (${pct}) за ${value.windowDays} дней.`;
});

function emptyLine(): string {
  if (tab.value === 'messages') return 'Новых диалогов в этом снимке нет.';
  if (tab.value === 'accepted') return 'Принятых приглашений в этом снимке нет.';
  return 'Имена посетителей в этом снимке отсутствуют.';
}
</script>

<template>
  <section id="v-inbox" class="view">
    <div class="page-heading">
      <h1 tabindex="-1">Входящие</h1>
      <button class="btn" data-testid="inbox-refresh" :disabled="refreshing" @click="refresh">
        {{ refreshing ? 'Обновляю…' : 'Обновить' }}
      </button>
    </div>
    <section class="stack" aria-label="Сводка интереса">
      <div>
        <h2>Просмотры профиля</h2>
        <p class="banner" data-testid="inbox-views">{{ viewLine }}</p>
      </div>
      <div>
        <h2>Принятые приглашения</h2>
        <p class="banner" data-testid="inbox-accept">{{ acceptLine }}</p>
      </div>
    </section>
    <p v-if="refreshError" class="banner error" data-testid="inbox-error" role="status">
      {{ refreshError }}
    </p>
    <p v-if="snapshot" class="hint" data-testid="inbox-age">
      {{ capturedLabel(snapshot.capturedAt) }}
    </p>
    <PanelTabs v-model="tab" :items="tabs" label="Источники интереса">
      <p v-if="loading" class="hint" role="status">Загружаю входящие…</p>
      <p v-if="!loading && !refreshError && !snapshot" class="empty">
        <strong>Данные ещё не загружены</strong>Откройте LinkedIn и обновите входящие.
      </p>
      <p
        v-if="!loading && snapshot && listStatus === 'unknown'"
        class="banner"
        data-testid="inbox-partial"
      >
        LinkedIn не предоставил этот список. Показатели выше сохранены.
      </p>
      <p v-else-if="!loading && !refreshError && snapshot && !shown.length" class="empty">
        {{ emptyLine() }}
      </p>
      <article v-for="person in shown" :key="person.id" class="list-row">
        <a v-if="person.profileUrl" :href="person.profileUrl" target="_blank" rel="noopener"
          ><b>{{ person.name }}</b></a
        ><b v-else>{{ person.name }}</b>
        <p v-if="person.role" class="hint">{{ person.role }}</p>
      </article>
    </PanelTabs>
  </section>
</template>
