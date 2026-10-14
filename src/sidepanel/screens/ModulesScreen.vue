<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import type { ModuleId, ModuleState } from '@lib/types';
import Icon from '../components/Icon.vue';
import ModuleCard from '../components/ModuleCard.vue';
import { useEngagementStats } from '../composables/useEngagementStats';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import {
  loadConnectSettings,
  saveConnectSettings,
  ensureSearchKeywords,
  DEFAULT_TARGET_REGIONS,
  type PymkMode,
} from '@lib/connect/settings';
import { REGION_KEYS } from '@lib/connect/regions';
import CountryMultiSelect from '../components/CountryMultiSelect.vue';
import { panelBus } from '../lib/panelBus';

defineProps<{ modules: ModuleState[]; saveError?: string }>();
defineEmits<{ toggle: [id: ModuleId]; setLimit: [id: ModuleId, n: number] }>();

const byId = (modules: ModuleState[], id: ModuleId): ModuleState => {
  const found = modules.find((module) => module.id === id);
  if (!found) throw new Error(`Missing module ${id}`);
  return found;
};

// Real, live engagement counters (not the demo hardcodes).
const { likes, comments, ceiling } = useEngagementStats();
const barWidth = computed(() =>
  ceiling.value > 0 ? `${Math.min(100, Math.round((likes.value / ceiling.value) * 100))}%` : '0%',
);

const connectKeywords = ref('');
const connectRegions = ref<string[]>([...DEFAULT_TARGET_REGIONS]);
const excludeIndia = ref(false);
const excludeKeywords = ref('');
const pymkMode = ref<PymkMode>('fill');
const notesPerMonth = ref(0);
const store = new ChromeStorageStore();
const audienceLoaded = ref(false);
const audienceLoading = ref(false);
const audienceLoadError = ref('');
async function loadAudience() {
  if (!panelBus.available() || audienceLoading.value) return;
  audienceLoading.value = true;
  audienceLoadError.value = '';
  try {
    const s = await loadConnectSettings(store);
    const keywords = await ensureSearchKeywords(store);
    connectRegions.value = s.targetRegions;
    excludeIndia.value = s.excludeIndia;
    excludeKeywords.value = s.excludeKeywords.join(', ');
    pymkMode.value = s.pymkMode;
    notesPerMonth.value = s.notesPerMonth;
    connectKeywords.value = keywords;
    audienceLoaded.value = true;
  } catch {
    audienceLoadError.value = 'Не удалось загрузить аудиторию. Попробуйте ещё раз.';
  } finally {
    audienceLoading.value = false;
  }
}
onMounted(loadAudience);
const connectSaved = ref(false);
let saveRevision = 0;
const connectError = ref('');
let saveTail = Promise.resolve();
function saveConnect() {
  if (!audienceLoaded.value) return;
  connectSaved.value = false;
  connectError.value = '';
  if (!panelBus.available()) {
    connectError.value = 'Настройки доступны в расширении Chrome.';
    return;
  }
  const revision = ++saveRevision;
  const snapshot = {
    searchKeywords: connectKeywords.value,
    targetRegions: [...connectRegions.value],
    excludeIndia: excludeIndia.value,
    excludeKeywords: excludeKeywords.value
      .split(',')
      .map((word) => word.trim())
      .filter(Boolean),
    pymkMode: pymkMode.value,
    notesPerMonth: Number.isFinite(notesPerMonth.value) ? Math.max(0, notesPerMonth.value) : 0,
  };
  saveTail = saveTail.catch(() => {}).then(() => saveConnectSettings(store, snapshot));
  void saveTail
    .then(() => {
      if (revision === saveRevision) connectSaved.value = true;
    })
    .catch(() => {
      if (revision === saveRevision)
        connectError.value = 'Не удалось сохранить аудиторию. Попробуйте ещё раз.';
    });
}
function setCountries(isos: string[]) {
  connectRegions.value = isos;
  saveConnect();
}
function selectAllCountries() {
  connectRegions.value = [...REGION_KEYS];
  saveConnect();
}
async function beforeLeave() {
  try {
    await saveTail;
    return true;
  } catch {
    return false;
  }
}
defineExpose({ beforeLeave });
</script>

<template>
  <section id="v-auto" class="view">
    <div class="page-heading"><h1 tabindex="-1">Автоматизация</h1></div>
    <p v-if="saveError" class="banner error" role="alert">{{ saveError }}</p>
    <section aria-labelledby="audience-title">
      <h2 id="audience-title">Аудитория</h2>
      <p v-if="audienceLoading" class="hint" role="status">Загружаю аудиторию…</p>
      <p v-if="audienceLoadError" class="banner error" role="alert">
        {{ audienceLoadError }}
        <button class="text-button" data-testid="retry-audience" @click="loadAudience">
          Повторить
        </button>
      </p>
      <p class="hint">Общая для приглашений и просмотров профилей.</p>
      <label class="fld"
        ><span class="k">Кого искать</span
        ><input
          v-model="connectKeywords"
          data-testid="audience-keywords"
          :disabled="!audienceLoaded"
          placeholder="Например, frontend recruiter"
          @change="saveConnect"
      /></label>
      <div class="fld">
        <div class="row spread">
          <span id="countries-label" class="hint">Страны</span
          ><button
            class="text-button"
            data-testid="countries-select-all"
            :disabled="!audienceLoaded"
            @click="selectAllCountries"
          >
            Все страны
          </button>
        </div>
        <CountryMultiSelect
          :model-value="connectRegions"
          :disabled="!audienceLoaded"
          @update:model-value="setCountries"
        />
      </div>
      <label class="check-label"
        ><input
          v-model="excludeIndia"
          type="checkbox"
          data-testid="exclude-india"
          :disabled="!audienceLoaded"
          @change="saveConnect"
        />Исключить Индию и стаффинг</label
      >
      <label class="fld"
        ><span class="k">Исключить по словам, через запятую</span
        ><input
          v-model="excludeKeywords"
          data-testid="exclude-keywords"
          :disabled="!audienceLoaded"
          placeholder="Например, staffing agency"
          @change="saveConnect"
      /></label>
      <span v-if="connectSaved" class="v ok" data-testid="connect-saved" role="status"
        >Аудитория сохранена</span
      >
      <p v-if="connectError" class="banner error" role="alert">
        {{ connectError }}
        <button class="text-button" @click="saveConnect">Повторить</button>
      </p>
    </section>
    <h2 class="sect-lbl">Модули автоматизации</h2>
    <ModuleCard
      :module="byId(modules, 'engagement')"
      title="Вовлечённость в ленте"
      desc="Лайки и комментарии к релевантным постам"
      limit-label="Лайков в день"
      recommended="30–40"
      @toggle="$emit('toggle', 'engagement')"
      @set-limit="(n) => $emit('setLimit', 'engagement', n)"
    >
      <template #icon><Icon name="engagement" /></template>
      <div class="mod-stats">
        <div class="stat">
          <div class="n" data-testid="stat-likes">{{ likes }}</div>
          <div class="l">Лайков сегодня</div>
        </div>
        <div class="stat">
          <div class="n" data-testid="stat-comments">{{ comments }}</div>
          <div class="l">Комментариев</div>
        </div>
        <div class="stat">
          <div class="n">{{ Math.max(0, ceiling - likes) }}</div>
          <div class="l">Осталось</div>
        </div>
      </div>
      <div class="track"><div class="fill" :style="{ width: barWidth }" /></div>
    </ModuleCard>
    <ModuleCard
      :module="byId(modules, 'smart_connect')"
      title="Приглашения в сеть"
      desc="Поиск людей по заданной аудитории"
      limit-label="Приглашений в неделю"
      recommended="около 100"
      @toggle="$emit('toggle', 'smart_connect')"
      @set-limit="(n) => $emit('setLimit', 'smart_connect', n)"
    >
      <template #icon><Icon name="people" /></template>
      <p class="hint">
        Приглашения отправляются без текста. Заметку для ручной отправки можно подготовить в
        истории.
      </p>
      <label class="fld"
        ><span class="k">Если поиск не добрал лимит</span
        ><select
          v-model="pymkMode"
          data-testid="pymk-mode"
          :disabled="!audienceLoaded"
          @change="saveConnect"
        >
          <option value="fill">Добрать из рекомендаций LinkedIn</option>
          <option value="search_only">Только мой поиск</option>
        </select></label
      >
      <label class="fld"
        ><span class="k">Заметок в месяц, 0 — не готовить</span
        ><input
          v-model.number="notesPerMonth"
          type="number"
          min="0"
          max="3"
          data-testid="notes-per-month"
          :disabled="!audienceLoaded"
          @change="saveConnect"
      /></label>
    </ModuleCard>
    <ModuleCard
      :module="byId(modules, 'profile_views')"
      title="Просмотры профилей"
      desc="Посещения профилей из общей аудитории"
      limit-label="Профилей в день"
      recommended="около 40"
      @toggle="$emit('toggle', 'profile_views')"
      @set-limit="(n) => $emit('setLimit', 'profile_views', n)"
      ><template #icon><Icon name="views" /></template>
      <p class="hint">
        Использует заданные выше слова и страны. Приглашения при просмотре не отправляются.
      </p></ModuleCard
    >
    <ModuleCard
      :module="byId(modules, 'content')"
      title="Идеи для публикаций"
      desc="Сбор тем из ленты во время запуска"
      limit-label="Идей в день"
      recommended="3–6"
      @toggle="$emit('toggle', 'content')"
      @set-limit="(n) => $emit('setLimit', 'content', n)"
      ><template #icon><Icon name="content" /></template>
      <p class="hint">
        Идеи появятся в разделе «Контент». Публикация требует одобрения черновика и отметки медиа.
      </p></ModuleCard
    >
  </section>
</template>
