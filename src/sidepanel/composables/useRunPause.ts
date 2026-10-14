import { onMounted, ref } from 'vue';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import { isPausedUntil, localDay, RUN_PAUSE_KEY, tomorrowKey } from '@lib/autopilot/runPause';
import { panelBus } from '../lib/panelBus';

export function useRunPause() {
  const store = new ChromeStorageStore();
  const paused = ref(false);

  async function reload() {
    if (!panelBus.available()) return;
    const value = await store.get(RUN_PAUSE_KEY);
    paused.value = isPausedUntil(value, localDay(new Date()));
  }

  async function pauseTomorrow() {
    await store.set(RUN_PAUSE_KEY, tomorrowKey(new Date()));
    paused.value = true;
  }

  async function resume() {
    await store.set(RUN_PAUSE_KEY, '');
    paused.value = false;
  }

  onMounted(() => {
    void reload();
  });
  return { paused, pauseTomorrow, resume, reload };
}
