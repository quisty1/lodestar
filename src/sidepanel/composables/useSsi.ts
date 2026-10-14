import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { SsiSnapshot } from '@lib/types';
import { SsiRepository } from '@lib/storage/SsiRepository';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import { panelBus } from '../lib/panelBus';
import { pillarsToView } from '../lib/ssiView';
import { upsertDailySnapshot } from '@lib/ssi/ssiHistory';
import type { RefreshResult } from '@lib/refresh/BackgroundRefreshService';

const REFRESH_ERROR = 'Не удалось обновить SSI. Показаны последние данные.';

/**
 * Owns the SSI snapshot lifecycle for the panel: load persisted latest,
 * listen for fresh parses, expose a refresh trigger. DIP: storage via repo.
 */
export function useSsi() {
  const snapshot = ref<SsiSnapshot | null>(null);
  const history = ref<SsiSnapshot[]>([]);
  const isReal = ref(false);
  const refreshing = ref(false);
  const refreshError = ref<string | null>(null);

  const repo = new SsiRepository(new ChromeStorageStore());
  let unsub = () => {};

  const apply = (snap: SsiSnapshot) => {
    snapshot.value = snap;
    // Keep the panel's history in sync with fresh parses (day-bucketed, latest wins),
    // so the trend updates live without waiting for a reload.
    history.value = upsertDailySnapshot(isReal.value ? history.value : [], snap);
    isReal.value = true;
    refreshError.value = null;
  };

  onMounted(async () => {
    if (panelBus.available()) {
      const [latest, hist] = await Promise.all([
        repo.latest().catch(() => null),
        repo.history().catch(() => []),
      ]);
      // Mark real BEFORE apply so the loaded persisted history is merged into, not
      // discarded (apply folds into [] while isReal is still false).
      if (hist.length) {
        history.value = hist;
        isReal.value = true;
      }
      if (latest) apply(latest);
      // Opening the panel triggers a background refresh if the daily cadence is
      // due — so data stays fresh regardless of which page the user is on.
      panelBus.send({ type: 'REQUEST_REFRESH' });
    }
    unsub = panelBus.onMessage((msg) => {
      if (msg.type === 'SSI_SNAPSHOT') apply(msg.payload);
    });
  });

  onUnmounted(() => {
    unsub();
  });

  // Manual refresh forces a background worker-window parse, so the button works
  // from any page (not only when a LinkedIn tab is focused).
  const refresh = async (): Promise<void> => {
    refreshing.value = true;
    refreshError.value = null;
    try {
      const result = await panelBus.request<unknown>({ type: 'FORCE_REFRESH' });
      if (!isRefreshResult(result)) refreshError.value = REFRESH_ERROR;
      else if (result.status === 'refreshed') apply(result.snapshot);
      else if (result.status === 'error') refreshError.value = REFRESH_ERROR;
    } finally {
      refreshing.value = false;
    }
  };

  const pillars = computed(() => (snapshot.value ? pillarsToView(snapshot.value) : []));
  const total = computed(() => snapshot.value?.total ?? 0);

  return {
    snapshot,
    history,
    pillars,
    total,
    isReal,
    refreshing,
    refreshError,
    refresh,
  };
}

function isRefreshResult(value: unknown): value is RefreshResult {
  if (!isRecord(value) || typeof value.status !== 'string') return false;
  if (value.status === 'busy' || value.status === 'skipped') return true;
  if (value.status === 'error') return typeof value.error === 'string';
  return value.status === 'refreshed' && isSsiSnapshot(value.snapshot);
}

function isSsiSnapshot(value: unknown): value is SsiSnapshot {
  if (!isRecord(value) || typeof value.total !== 'number' || !Number.isFinite(value.total))
    return false;
  if (typeof value.capturedAt !== 'string' || !Array.isArray(value.pillars)) return false;
  return value.pillars.every(
    (pillar) =>
      isRecord(pillar) &&
      typeof pillar.key === 'string' &&
      typeof pillar.label === 'string' &&
      typeof pillar.score === 'number' &&
      Number.isFinite(pillar.score),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
