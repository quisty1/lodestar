import { computed, onMounted, ref } from 'vue';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import { acceptRate } from '@lib/connect/acceptRate';
import { CONNECT_HISTORY_KEY, type ConnectRecord } from '@lib/connect/ConnectHistory';
import { asArray } from '@lib/engagement/settings';
import {
  INBOX_ACCEPTED_KEY,
  INBOX_SNAPSHOT_KEY,
  type AcceptedScan,
  type InboxSnapshot,
} from '@lib/inbox/snapshot';
import type { InboundPerson } from '@lib/inbox/people';
import { computeViewsProgress } from '@lib/profileViews/profileViewsProgress';
import type { ProfileViewsSnapshot } from '@lib/types';
import { panelBus } from '../lib/panelBus';

export function useInbox(profileViews: () => ProfileViewsSnapshot[]) {
  const store = new ChromeStorageStore();
  const snapshot = ref<InboxSnapshot | null>(null);
  const acceptedIds = ref<string[] | null>(null);
  const connects = ref<ConnectRecord[]>([]);
  const refreshing = ref(false);
  const loading = ref(false);
  const refreshError = ref('');

  const views = computed(() => computeViewsProgress(profileViews()));
  const rate = computed(() =>
    acceptRate(
      connects.value,
      acceptedIds.value === null ? null : new Set(acceptedIds.value),
      new Date(),
    ),
  );
  const people = computed(() => {
    const snap = snapshot.value;
    if (!snap) return [] as InboundPerson[];
    return [...snap.viewers, ...snap.accepted, ...snap.messages];
  });

  async function load() {
    if (!panelBus.available()) return;
    if (loading.value) return;
    loading.value = true;
    refreshError.value = '';
    try {
      const [stored, scan, history] = await Promise.all([
        store.get<InboxSnapshot>(INBOX_SNAPSHOT_KEY),
        store.get<AcceptedScan>(INBOX_ACCEPTED_KEY),
        store.get(CONNECT_HISTORY_KEY),
      ]);
      snapshot.value = stored;
      acceptedIds.value = scan ? asArray<string>(scan.memberIds) : null;
      connects.value = asArray<ConnectRecord>(history);
    } catch {
      refreshError.value = 'Не удалось загрузить входящие. Попробуйте ещё раз.';
    } finally {
      loading.value = false;
    }
  }

  async function refresh() {
    refreshing.value = true;
    refreshError.value = '';
    const next = await panelBus.request<InboxSnapshot>({ type: 'REFRESH_INBOUND' });
    refreshing.value = false;
    if (!next) {
      refreshError.value = 'Не удалось прочитать входящие. Показаны последние данные.';
      return;
    }
    snapshot.value = next;
    await load();
  }

  onMounted(() => {
    void load();
  });
  return { snapshot, views, rate, people, loading, refreshing, refreshError, refresh, load };
}
