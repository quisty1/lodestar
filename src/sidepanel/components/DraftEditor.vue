<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Draft, Idea } from '@lib/types';
import { assessPost } from '@lib/content/postFormat';
const props = defineProps<{
  draft: Draft;
  postsLeft: number;
  updateText: (id: string, text: string) => Promise<void>;
  approve: (id: string, approved: boolean) => Promise<void>;
  setMedia: (id: string, attached: boolean) => Promise<void>;
  setKind: (id: string, kind: Draft['kind']) => Promise<void>;
  remove: (id: string) => Promise<void>;
  regenerate: (idea: Idea, key: string) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();
const text = ref(props.draft.text);
const committed = ref(props.draft.text);
const busy = ref('');
const error = ref('');
const saved = ref(false);
const copyStatus = ref('');
const checks = computed(() => assessPost(text.value, props.draft.mediaAttached === true));
let savePromise: Promise<boolean> | null = null;
async function saveText(): Promise<boolean> {
  if (savePromise) return savePromise;
  if (text.value === committed.value) return true;
  busy.value = 'saving';
  error.value = '';
  saved.value = false;
  const snapshot = text.value;
  savePromise = (async () => {
    try {
      await props.updateText(props.draft.id, snapshot);
      committed.value = snapshot;
      saved.value = true;
      return true;
    } catch {
      error.value = 'Не удалось сохранить текст. Попробуйте ещё раз.';
      return false;
    } finally {
      busy.value = '';
      savePromise = null;
    }
  })();
  return savePromise;
}
async function beforeLeave() {
  if (busy.value && busy.value !== 'saving') return false;
  return await saveText();
}
async function close() {
  if (await beforeLeave()) emit('close');
}
async function action(name: string, operation: () => Promise<void>, closes = false) {
  if (busy.value) return;
  if (!(await saveText())) return;
  busy.value = name;
  error.value = '';
  try {
    await operation();
    if (closes) emit('close');
  } catch {
    error.value = 'Не удалось выполнить действие. Попробуйте ещё раз.';
  } finally {
    busy.value = '';
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(text.value);
    copyStatus.value = 'Скопировано';
  } catch {
    copyStatus.value = 'Не удалось скопировать';
  }
}
defineExpose({ beforeLeave });
</script>
<template>
  <div>
    <button class="ghost" data-testid="close-editor" :disabled="Boolean(busy)" @click="close">
      Вернуться к черновикам
    </button>
    <article class="editor">
      <h2>{{ draft.ideaTopic }}</h2>
      <label class="fld"
        ><span class="k">Текст публикации</span
        ><textarea
          v-model="text"
          rows="10"
          data-testid="draft-text"
          :disabled="Boolean(busy)"
          @input="saved = false"
        />
      </label>
      <div class="row spread">
        <span class="hint">{{ checks.length }} символов</span
        ><span v-if="saved" class="v ok" :data-testid="`draft-saved-${draft.id}`" role="status"
          >Сохранено</span
        ><button
          class="text-button"
          :disabled="Boolean(busy)"
          data-testid="save-draft"
          @click="saveText"
        >
          {{ busy === 'saving' ? 'Сохраняю…' : 'Сохранить текст' }}
        </button>
      </div>
      <p v-if="error" class="banner error" data-testid="editor-error" role="alert">{{ error }}</p>
      <details open>
        <summary>Проверки публикации</summary>
        <div class="stack" :data-testid="`format-${draft.id}`">
          <p class="hint">
            {{ checks.hashtagsOk ? 'Хештеги: в порядке' : 'Добавьте 3–5 хештегов' }}
          </p>
          <p class="hint">
            {{
              checks.linkInBody ? 'Перенесите ссылку в первый комментарий' : 'Ссылки в тексте нет'
            }}
          </p>
          <p class="hint">
            {{ draft.mediaAttached ? 'Медиа отмечено' : 'Автопубликация ждёт отметку медиа' }}
          </p>
          <p v-if="draft.kind === 'repost'" class="hint">Репост с припиской публикуется вручную.</p>
        </div>
      </details>
      <label class="check-label"
        ><input
          type="checkbox"
          :checked="draft.mediaAttached === true"
          :disabled="Boolean(busy)"
          :data-testid="`media-${draft.id}`"
          @change="action('media', () => setMedia(draft.id, !draft.mediaAttached))"
        />Картинка или другое медиа приложено</label
      >
      <p class="hint">
        Одобрение разрешает автоматическую публикацию в выбранные дни. Осталось на неделе:
        {{ postsLeft }}.
      </p>
      <span v-if="draft.approved" class="v ok" :data-testid="`approved-badge-${draft.id}`"
        >Одобрено для публикации</span
      >
      <div class="actions">
        <button
          v-if="!draft.approved"
          class="btn primary"
          :disabled="Boolean(busy)"
          :data-testid="`approve-${draft.id}`"
          @click="action('approve', () => approve(draft.id, true))"
        >
          {{ busy === 'approve' ? 'Одобряю…' : 'Одобрить публикацию' }}</button
        ><button
          v-else
          class="btn"
          :disabled="Boolean(busy)"
          :data-testid="`unapprove-${draft.id}`"
          @click="action('approve', () => approve(draft.id, false))"
        >
          Отозвать одобрение</button
        ><button class="btn" :data-testid="`copy-${draft.id}`" @click="copy">
          {{ copyStatus || 'Копировать' }}
        </button>
      </div>
      <details>
        <summary>Другие действия</summary>
        <div class="stack">
          <button
            class="btn"
            :disabled="Boolean(busy)"
            @click="
              action(
                'regenerate',
                () =>
                  regenerate(
                    { topic: draft.ideaTopic, angle: draft.ideaAngle },
                    `draft-${draft.id}`,
                  ),
                true,
              )
            "
          >
            Создать новую версию</button
          ><button
            class="btn"
            :disabled="Boolean(busy)"
            @click="
              action('kind', () => setKind(draft.id, draft.kind === 'repost' ? 'post' : 'repost'))
            "
          >
            {{
              draft.kind === 'repost' ? 'Сделать публикацией' : 'Сделать репостом с припиской'
            }}</button
          ><button
            class="btn stop"
            :disabled="Boolean(busy)"
            @click="action('delete', () => remove(draft.id), true)"
          >
            Удалить черновик
          </button>
        </div>
      </details>
    </article>
  </div>
</template>
