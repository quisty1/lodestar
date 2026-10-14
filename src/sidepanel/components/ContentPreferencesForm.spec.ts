import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { CommentTone } from '@lib/types';
import ContentPreferencesForm from './ContentPreferencesForm.vue';

describe('ContentPreferencesForm', () => {
  it('toggles a publish day and keeps the list sorted', async () => {
    const publishDays = ref([1, 3, 5]);
    const wrapper = mount(ContentPreferencesForm, {
      props: {
        form: {
          prompt: ref(''),
          commentsEnabled: ref(false),
          commentsPerDay: ref(5),
          commentTone: ref<CommentTone>('expert'),
          postsPerWeek: ref(3),
          publishDays,
          contentLanguage: ref('ru'),
          voiceSamples: ref(''),
          load: async () => {},
          save: async () => {},
        },
      },
    });
    await wrapper.get('[data-testid="pubday-1"]').trigger('change');
    expect(publishDays.value).toEqual([3, 5]);
    await wrapper.get('[data-testid="pubday-2"]').trigger('change');
    expect(publishDays.value).toEqual([2, 3, 5]);
  });
});
