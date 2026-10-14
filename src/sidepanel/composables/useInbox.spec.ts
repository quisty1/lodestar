import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { INBOX_ACCEPTED_KEY, INBOX_SNAPSHOT_KEY, type InboxSnapshot } from '@lib/inbox/snapshot';
import { CONNECT_HISTORY_KEY } from '@lib/connect/ConnectHistory';
import { useInbox } from './useInbox';

const mem = new Map<string, unknown>();

beforeEach(() => {
  mem.clear();
  vi.stubGlobal('chrome', {
    runtime: { id: 'x', sendMessage: vi.fn(async () => null) },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: mem.get(key) })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const key of Object.keys(values)) mem.set(key, values[key]);
        }),
      },
    },
  });
});

const snapshot: InboxSnapshot = {
  capturedAt: '2026-10-08T00:00:00.000Z',
  viewers: [{ id: 'v', name: 'Vera', role: '', kind: 'viewed' }],
  viewersStatus: 'known',
  messages: [{ id: 'm', name: 'Mia', role: '', kind: 'messaged' }],
  messagesStatus: 'known',
  accepted: [{ id: 'a', name: 'Ada', role: '', kind: 'accepted' }],
  acceptedStatus: 'known',
};

describe('useInbox', () => {
  it('loads viewers, accepted people, and messages', async () => {
    mem.set(INBOX_SNAPSHOT_KEY, snapshot);
    mem.set(INBOX_ACCEPTED_KEY, { scannedAt: snapshot.capturedAt, memberIds: ['a'] });
    mem.set(CONNECT_HISTORY_KEY, []);
    const api = mountInbox();
    await flushPromises();
    expect(api.people.value.map((person) => person.id)).toEqual(['v', 'a', 'm']);
    expect(api.refreshError.value).toBe('');
  });

  it('reports a storage failure', async () => {
    chrome.storage.local.get = vi.fn(async () => Promise.reject(new Error('disk')));
    const api = mountInbox();
    await flushPromises();
    expect(api.refreshError.value).toBe('Не удалось загрузить входящие. Попробуйте ещё раз.');
  });

  it('reports a failed inbound refresh', async () => {
    const api = mountInbox();
    await flushPromises();
    await api.refresh();
    expect(api.refreshError.value).toBe(
      'Не удалось прочитать входящие. Показаны последние данные.',
    );
  });
});

function mountInbox() {
  let api!: ReturnType<typeof useInbox>;
  mount(
    defineComponent({
      setup() {
        api = useInbox(() => []);
        return () => null;
      },
    }),
  );
  return api;
}
