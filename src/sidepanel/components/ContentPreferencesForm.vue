<script setup lang="ts">
import type { useContentSettings } from '../composables/useContentSettings';
const props = defineProps<{ form: ReturnType<typeof useContentSettings> }>();
const WEEKDAYS = [
  { n: 1, label: 'Пн' },
  { n: 2, label: 'Вт' },
  { n: 3, label: 'Ср' },
  { n: 4, label: 'Чт' },
  { n: 5, label: 'Пт' },
  { n: 6, label: 'Сб' },
  { n: 0, label: 'Вс' },
];
function togglePubDay(n: number) {
  const cur = props.form.publishDays.value;
  props.form.publishDays.value = cur.includes(n)
    ? cur.filter((x) => x !== n)
    : [...cur, n].sort((a, b) => a - b);
}
</script>
<template>
  <div>
    <div class="sect-lbl">Промпт генератора постов</div>
    <label class="fld">
      <span class="k">Структура и стиль черновика</span>
      <textarea v-model="form.prompt.value" rows="6" data-testid="post-prompt" />
    </label>
    <div class="sect-lbl">Авто-комментарии в ленте</div>
    <label class="fld">
      <span class="k">
        <input
          v-model="form.commentsEnabled.value"
          type="checkbox"
          data-testid="comments-enabled"
        />
        Автоматически комментировать релевантные посты
      </span>
    </label>
    <label class="fld">
      <span class="k">Комментариев в день (рек. 3–8)</span>
      <input
        v-model.number="form.commentsPerDay.value"
        type="number"
        min="1"
        data-testid="comments-per-day"
      />
    </label>
    <label class="fld">
      <span class="k">Тон комментария</span>
      <select v-model="form.commentTone.value" data-testid="comment-tone">
        <option value="expert">Экспертный</option>
        <option value="friendly">Дружелюбный</option>
        <option value="question">Вопрос</option>
      </select>
    </label>
    <div class="sect-lbl">Публикация постов</div>
    <label class="fld">
      <span class="k">Постов в неделю (рекомендуем 2–3)</span>
      <input
        v-model.number="form.postsPerWeek.value"
        type="number"
        min="1"
        data-testid="posts-per-week"
      />
    </label>
    <div class="fld">
      <span class="k"
        >Дни авто-публикации (бот публикует одобренный пост в выбранный день, когда работает)</span
      >
      <div class="weekdays">
        <label v-for="day in WEEKDAYS" :key="day.n" class="chip">
          <input
            type="checkbox"
            :data-testid="`pubday-${day.n}`"
            :checked="form.publishDays.value.includes(day.n)"
            @change="togglePubDay(day.n)"
          />
          {{ day.label }}
        </label>
      </div>
    </div>
    <label class="fld">
      <span class="k">Язык постов и комментариев</span>
      <select v-model="form.contentLanguage.value" data-testid="content-language">
        <option value="en">Английский</option>
        <option value="ru">Русский</option>
      </select>
    </label>
  </div>
</template>
