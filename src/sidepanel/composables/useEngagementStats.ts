import { ref, onMounted, onUnmounted } from 'vue';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import { panelBus } from '../lib/panelBus';

interface DayCount {
  day: string;
  used: number;
}
interface AutopilotStateLite {
  day: string;
  used: number;
  ceiling: number;
}

/**
 * Live engagement counters for the «Модули» card — the REAL likes/comments today
 * and the daily ceiling, not the demo hardcodes. Reads autopilot:state (likes +
 * ceiling) and comments:budget (comments), refreshing on every chrome.storage write
 * (the SW bumps these per action), so the card ticks up during a run.
 */
export function useEngagementStats() {
  const likes = ref(0);
  const comments = ref(0);
  const ceiling = ref(0);
  const store = new ChromeStorageStore();
  const today = () => new Date().toISOString().slice(0, 10);

  const refresh = async () => {
    if (!panelBus.available()) return;
    const ap = await store.get<AutopilotStateLite>('autopilot:state').catch(() => null);
    likes.value = ap && ap.day === today() ? ap.used : 0;
    ceiling.value = ap?.ceiling ?? 0;
    const cb = await store.get<DayCount>('comments:budget').catch(() => null);
    comments.value = cb && cb.day === today() ? cb.used : 0;
  };

  let off = () => {};
  onMounted(() => {
    void refresh();
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      const listener = () => void refresh();
      chrome.storage.onChanged.addListener(listener);
      off = () => {
        chrome.storage.onChanged.removeListener(listener);
      };
    }
  });
  onUnmounted(() => {
    off();
  });

  return { likes, comments, ceiling };
}
