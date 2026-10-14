<script setup lang="ts">
import { computed } from 'vue';
import type { ProfileAuditStatus } from '@lib/profile/contracts';
import { useProfileAudit } from '../composables/useProfileAudit';
import { prioritizeAuditItems } from '@lib/profile/auditPriority';

const { audit, loading, error, start } = useProfileAudit();
const statuses = ['fail', 'warn', 'pass', 'unknown'] as const;
const labels: Record<ProfileAuditStatus, string> = {
  fail: 'Исправить сначала',
  warn: 'Усилить',
  pass: 'В порядке',
  unknown: 'Не удалось проверить',
};
const icons: Record<ProfileAuditStatus, string> = {
  fail: '✕',
  warn: '!',
  pass: '✓',
  unknown: '?',
};
const groups = computed(() =>
  statuses.map((status) => ({
    status,
    label: labels[status],
    items: prioritizeAuditItems(audit.value?.items.filter((item) => item.status === status) ?? []),
  })),
);
function auditText(text: string): string {
  return text
    .replace(/Headline|headline/g, 'Заголовок профиля')
    .replace(/About/g, 'Раздел «О себе»')
    .replace(/Featured/g, 'Раздел «Избранное»')
    .replace(/Experience/g, 'Опыт')
    .replace(/Open to Work/g, 'Статус поиска работы');
}
const auditedAt = computed(() =>
  audit.value
    ? new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(audit.value.auditedAt))
    : '',
);
</script>

<template>
  <section id="v-profile" class="view">
    <div class="page-heading"><h1 tabindex="-1">Аудит профиля</h1></div>

    <div class="banner intro">
      Проверю заполненность и видимость профиля по наблюдаемым данным LinkedIn. Без LLM и без
      отправки текста профиля наружу.
    </div>

    <div
      v-if="error"
      class="banner audit-error"
      data-testid="profile-audit-error"
      aria-live="polite"
    >
      {{ error }}
    </div>

    <template v-if="audit">
      <template v-for="group in groups" :key="group.status">
        <details
          v-if="group.items.length"
          :open="group.status === 'fail'"
          class="audit-group"
          :data-testid="`audit-${group.status}`"
        >
          <summary>{{ group.label }} ({{ group.items.length }})</summary>
          <article v-for="item in group.items" :key="item.key" class="note audit-item">
            <span class="status" :class="group.status">{{ icons[group.status] }}</span>
            <div>
              <b>{{ auditText(item.label) }}</b>
              <p>{{ auditText(item.evidence) }}</p>
              <a v-if="item.status !== 'pass'" :href="item.editUrl" target="_blank" rel="noopener">
                {{ auditText(item.recommendation) }}
              </a>
              <button v-if="item.status !== 'pass'" class="ghost" type="button" @click="start">
                Перепроверить профиль
              </button>
            </div>
          </article>
        </details>
      </template>

      <div class="sect-lbl">Категории</div>
      <div class="category-grid" data-testid="audit-categories">
        <div v-for="category in audit.categories" :key="category.key" class="category-card">
          <span>{{ category.label }}</span>
          <b>{{ category.progress === null ? '—' : `${category.progress}%` }}</b>
          <small v-if="category.unknown">Не проверено: {{ category.unknown }}</small>
        </div>
      </div>

      <div v-if="audit.metrics.searchAppearances !== undefined" class="banner metric">
        Появления в поиске: <b>{{ audit.metrics.searchAppearances }}</b>
      </div>

      <div class="banner">Проверено: {{ auditedAt }}</div>
    </template>

    <button
      class="btn primary audit-start"
      data-testid="start-profile-audit"
      :disabled="loading"
      @click="start"
    >
      {{ loading ? 'Проверяю профиль…' : audit ? 'Повторить аудит' : 'Запустить аудит' }}
    </button>
  </section>
</template>
