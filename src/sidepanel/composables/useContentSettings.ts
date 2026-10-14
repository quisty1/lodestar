import { ref } from 'vue';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import {
  loadContentSettings,
  saveContentSettings,
  DEFAULT_CONTENT_LANGUAGE,
  DEFAULT_PUBLISH_DAYS,
} from '@lib/content/settings';
import { DEFAULT_POSTS_PER_WEEK } from '@lib/content/PostWeekBudget';
import type { CommentTone } from '@lib/types';

/** Settings-screen state for the post-generator prompt + auto-comment config. */
export function useContentSettings() {
  const store = new ChromeStorageStore();
  const prompt = ref('');
  const commentsEnabled = ref(false);
  const commentsPerDay = ref(5);
  const commentTone = ref<CommentTone>('expert');
  const postsPerWeek = ref(DEFAULT_POSTS_PER_WEEK);
  const contentLanguage = ref(DEFAULT_CONTENT_LANGUAGE);
  const publishDays = ref(DEFAULT_PUBLISH_DAYS);
  const voiceSamples = ref('');

  async function load() {
    const s = await loadContentSettings(store);
    prompt.value = s.postPrompt;
    commentsEnabled.value = s.commentsEnabled;
    commentsPerDay.value = s.commentsPerDay;
    commentTone.value = s.commentTone;
    postsPerWeek.value = s.postsPerWeek;
    contentLanguage.value = s.contentLanguage;
    publishDays.value = s.publishDays;
    voiceSamples.value = s.voiceSamples.join('\n\n');
  }

  async function save() {
    await saveContentSettings(store, {
      postPrompt: prompt.value,
      commentsEnabled: commentsEnabled.value,
      commentsPerDay: commentsPerDay.value,
      commentTone: commentTone.value,
      postsPerWeek: postsPerWeek.value,
      contentLanguage: contentLanguage.value,
      publishDays: publishDays.value,
      voiceSamples: voiceSamples.value
        .split(/\n\s*\n/)
        .map((sample) => sample.trim())
        .filter(Boolean)
        .slice(0, 3),
    });
  }

  return {
    prompt,
    commentsEnabled,
    commentsPerDay,
    commentTone,
    postsPerWeek,
    contentLanguage,
    publishDays,
    voiceSamples,
    load,
    save,
  };
}
