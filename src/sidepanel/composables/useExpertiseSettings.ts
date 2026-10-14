import { ref } from 'vue';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import {
  loadSettings,
  saveSettings,
  applyExpertiseForm,
  type ExpertiseForm,
} from '@lib/engagement/settings';

/** Settings-screen state for the user's expertise (lives in engagement:settings, SSOT). */
export function useExpertiseSettings() {
  const store = new ChromeStorageStore();
  const form = ref<ExpertiseForm>({ headline: '', stack: '', bio: '' });

  async function load() {
    const s = await loadSettings(store);
    form.value = {
      headline: s.expertise.headline,
      stack: s.expertise.stack.join(', '),
      bio: s.expertise.bio ?? '',
    };
  }

  async function save() {
    const current = await loadSettings(store);
    await saveSettings(store, applyExpertiseForm(current, form.value));
  }

  return { form, load, save };
}
