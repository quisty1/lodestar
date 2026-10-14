<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useLlmSettings } from '../composables/useLlmSettings';
import { useExpertiseSettings } from '../composables/useExpertiseSettings';
import { useContentSettings } from '../composables/useContentSettings';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import { normalizeSchedule, SCHEDULE_KEY, type WeekdaySchedule } from '@lib/schedule/weekdayRun';
import ContentPreferencesForm from '../components/ContentPreferencesForm.vue';
import PanelTabs from '../components/PanelTabs.vue';
import { panelBus } from '../lib/panelBus';
import ModelCombobox from '../components/ModelCombobox.vue';
const {
  config,
  models,
  catalogSource,
  keyStatus,
  statusReason,
  loading,
  load,
  save,
  fetchModels,
  resetVerification,
} = useLlmSettings();
function onProviderChanged() {
  config.value.model = undefined;
  resetVerification();
}
const modelSaved = ref(false);
async function onModelPicked() {
  modelSaved.value = false;
  try {
    await save();
    modelSaved.value = true;
  } catch {
    saveError.value = true;
  }
}
const exp = useExpertiseSettings();
const content = useContentSettings();
const schedule = ref<WeekdaySchedule>({ enabled: false, hour: 10 });
const scheduleStore = new ChromeStorageStore();
const group = ref('connection');
const groups = [
  { id: 'connection', label: 'Подключение' },
  { id: 'style', label: 'Профиль и стиль' },
  { id: 'schedule', label: 'Расписание' },
  { id: 'content', label: 'Контент' },
];
const loadError = ref('');
const hydrating = ref(panelBus.available());
onMounted(async () => {
  if (!panelBus.available()) return;
  hydrating.value = true;
  try {
    await Promise.all([load(), exp.load(), content.load()]);
    schedule.value = normalizeSchedule(await scheduleStore.get(SCHEDULE_KEY));
  } catch {
    loadError.value = 'Не удалось загрузить настройки. Откройте панель ещё раз.';
  } finally {
    hydrating.value = false;
  }
});
const saveError = ref(false);
const saving = ref(false);
const saved = ref(false);
async function onSave() {
  if (saving.value || hydrating.value || loadError.value) return;
  saved.value = false;
  saving.value = true;
  saveError.value = false;
  const results = await Promise.allSettled([
    save(),
    exp.save(),
    content.save(),
    scheduleStore.set(SCHEDULE_KEY, {
      enabled: schedule.value.enabled,
      hour: schedule.value.hour || 10,
    }),
  ]);
  saving.value = false;
  const ok = !results.some((r) => r.status === 'rejected');
  saveError.value = !ok;
  if (ok) {
    saved.value = true;
    setTimeout(() => {
      saved.value = false;
    }, 1800);
  }
}
</script>
<template>
  <section id="v-settings" class="view">
    <div class="page-heading"><h1 tabindex="-1">Настройки</h1></div>
    <PanelTabs v-model="group" :items="groups" label="Группы настроек" wrap>
      <p v-if="hydrating" class="hint" role="status">Загружаю настройки…</p>
      <p v-if="loadError" class="banner error" role="alert">{{ loadError }}</p>
      <fieldset :disabled="saving || hydrating || Boolean(loadError)" class="settings-fields">
        <div v-show="group === 'connection'">
          <div class="sect-lbl">API-ключ и модель</div>
          <label class="fld">
            <span class="k">Провайдер</span>
            <select
              v-model="config.provider"
              data-testid="llm-provider"
              @change="onProviderChanged"
            >
              <option value="openrouter">OpenRouter</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </label>
          <label class="fld">
            <span class="k">API-ключ</span>
            <input
              v-model="config.apiKey"
              type="password"
              data-testid="llm-key"
              placeholder="sk-… / AIza…"
              @input="resetVerification"
            />
          </label>
          <button class="btn" :disabled="loading" data-testid="llm-fetch" @click="fetchModels">
            {{ loading ? 'Загрузка…' : 'Загрузить модели' }}
          </button>
          <span v-if="keyStatus === 'valid'" class="v ok" data-testid="llm-valid">
            {{
              catalogSource === 'live'
                ? 'Ключ подтверждён · модели загружены'
                : 'Ключ подтверждён · показан запасной каталог'
            }}
          </span>
          <span v-else-if="keyStatus === 'invalid'" class="v" data-testid="llm-invalid">
            {{
              statusReason === 'empty_key'
                ? 'Введи API-ключ'
                : statusReason === 'management_key'
                  ? 'Management key не подходит для генерации контента'
                  : 'Ключ отклонён провайдером'
            }}
          </span>
          <span v-else-if="keyStatus === 'unknown'" class="v" data-testid="llm-unknown">
            Провайдер недоступен — ключ не проверен
          </span>
          <label v-if="models.length || config.model" class="fld">
            <span class="k">Модель</span>
            <ModelCombobox
              v-model="config.model"
              :models="models"
              @update:model-value="onModelPicked"
            />
            <span v-if="modelSaved && config.model" class="v ok" data-testid="model-saved">
              Сохранена: {{ config.model }}
            </span>
          </label>
        </div>
        <div v-show="group === 'style'">
          <div class="sect-lbl">Экспертиза</div>
          <label class="fld">
            <span class="k">Заголовок</span>
            <input
              v-model="exp.form.value.headline"
              data-testid="exp-headline"
              placeholder="Техлид разработки, 11 лет опыта, Vue/TS"
            />
          </label>
          <label class="fld">
            <span class="k">Стек (через запятую)</span>
            <input
              v-model="exp.form.value.stack"
              data-testid="exp-stack"
              placeholder="Vue, TypeScript, Nuxt"
            />
          </label>
          <label class="fld">
            <span class="k">О себе</span>
            <textarea v-model="exp.form.value.bio" rows="3" data-testid="exp-bio" />
          </label>
          <div class="sect-lbl">Голос</div>
          <label class="fld">
            <span class="k">2–3 своих поста, через пустую строку</span>
            <textarea v-model="content.voiceSamples.value" rows="5" data-testid="voice-samples" />
          </label>
        </div>
        <div v-show="group === 'schedule'">
          <div class="sect-lbl">Расписание</div>
          <label class="fld">
            <span class="k">
              <input v-model="schedule.enabled" type="checkbox" data-testid="schedule-enabled" />
              Запускать сам по будням
            </span>
          </label>
          <label class="fld">
            <span class="k"
              >Час (местное время). Один раз в день, в этот час или позже, если вкладка LinkedIn
              открыта.</span
            >
            <input
              v-model.number="schedule.hour"
              type="number"
              min="0"
              max="23"
              data-testid="schedule-hour"
            />
          </label>
        </div>
        <div v-show="group === 'content'"><ContentPreferencesForm :form="content" /></div>
      </fieldset>
      <div class="save-bar" aria-live="polite">
        <button
          class="btn primary"
          data-testid="llm-save"
          :disabled="saving || hydrating || Boolean(loadError)"
          @click="onSave"
        >
          {{ saving ? 'Сохраняю…' : 'Сохранить' }}
        </button>
        <span v-if="saved" class="v ok" data-testid="save-ok">Сохранено</span>
        <span v-if="saveError" class="v" data-testid="save-error"
          >Не удалось сохранить — попробуй ещё раз</span
        >
      </div></PanelTabs
    >
  </section>
</template>
