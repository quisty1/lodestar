import { ref, onMounted, onUnmounted } from 'vue';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import type { AutopilotState, RunReport } from '@lib/types';
import { COMMENT_JOURNAL_KEY } from '@lib/engagement/commentJournal';
import { panelBus } from '../lib/panelBus';
import { emptyDayStats, projectDayStats, type DayStats } from '../lib/dayTally';

export type { DayStats };

/**
 * Today's tally. Each metric is confirmed actions (ledger and today's reports)
 * beside the defensive budget the run already spent.
 */
const LIKE_KEY = 'autopilot:state';
const COMMENT_BUDGET_KEY = 'comments:budget';
const REPORTS_KEY = 'autopilot:reports';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useDayStats() {
  const stats = ref<DayStats>(emptyDayStats());

  const reload = async () => {
    if (!panelBus.available()) return;
    const store = new ChromeStorageStore();
    const [views, connects, ideas, state, comments, rawReports, journal] = await Promise.all([
      store.get('views:daily'),
      store.get('connects:daily'),
      store.get('ideas:budget'),
      store.get<AutopilotState>(LIKE_KEY),
      store.get(COMMENT_BUDGET_KEY),
      store.get<RunReport[]>(REPORTS_KEY),
      store.get(COMMENT_JOURNAL_KEY),
    ]);
    stats.value = projectDayStats({
      today: todayKey(),
      state,
      reports: Array.isArray(rawReports) ? rawReports : [],
      views,
      connects,
      ideas,
      comments,
      journal,
    });
  };

  let off = () => {};
  onMounted(() => {
    void reload();
    off = panelBus.onMessage((m) => {
      if (
        m.type === 'AUTOPILOT_STATUS' ||
        m.type === 'AUTOPILOT_REPORT' ||
        m.type === 'AUTOPILOT_STAGE'
      ) {
        void reload();
      }
    });
  });
  onUnmounted(() => {
    off();
  });

  return { stats, reload };
}
