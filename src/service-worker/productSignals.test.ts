import { describe, expect, it, vi } from 'vitest';
import { FakeStore } from '@lib/storage/fakeStore';
import { CONNECT_HISTORY_KEY } from '@lib/connect/ConnectHistory';
import { COMMENT_JOURNAL_KEY } from '@lib/engagement/commentJournal';
import { INBOX_ACCEPTED_KEY, INBOX_SNAPSHOT_KEY } from '@lib/inbox/snapshot';
import { DRAFTS_KEY } from '@lib/content/DraftStore';
import type { JsonHttpGet } from '@lib/ssi-api/contracts';
import type { Draft } from '@lib/types';
import { draftsWaiting, recordComment, refreshInbound } from './productSignals';

const now = new Date('2026-10-08T12:00:00.000Z');

describe('recordComment', () => {
  it('appends a comment to the journal', async () => {
    const store = new FakeStore();
    await recordComment(store, {
      id: 'c1',
      text: 'hello',
      author: 'Ada',
      postUrn: 'urn:li:activity:1',
      at: now.toISOString(),
    });
    const journal = await store.get<unknown[]>(COMMENT_JOURNAL_KEY);
    expect(journal).toEqual([
      {
        id: 'c1',
        text: 'hello',
        author: 'Ada',
        postUrn: 'urn:li:activity:1',
        at: now.toISOString(),
      },
    ]);
  });
});

describe('refreshInbound', () => {
  it('keeps every lane unknown when there is no csrf token', async () => {
    const http = { getJson: vi.fn() };
    const snapshot = await refreshInbound(
      new FakeStore(),
      http,
      { getToken: async () => null },
      now,
    );
    expect(http.getJson).not.toHaveBeenCalled();
    expect(snapshot.viewersStatus).toBe('unknown');
    expect(snapshot.messagesStatus).toBe('unknown');
    expect(snapshot.acceptedStatus).toBe('unknown');
    expect(snapshot.accepted).toEqual([]);
  });

  it('records a known acceptance and treats a failed request as unknown', async () => {
    const store = new FakeStore();
    await store.set(CONNECT_HISTORY_KEY, [
      {
        memberId: 'ada',
        name: 'Ada Lovelace',
        headline: 'Engineer',
        profileUrl: 'https://www.linkedin.com/in/ada',
        sentAt: '2026-10-01T00:00:00.000Z',
      },
    ]);
    const http = {
      getJson: vi.fn(async (url: string) => {
        if (url.includes('wvmpCards')) throw new Error('down');
        if (url.includes('connections')) {
          return { elements: [{ name: 'Ada Lovelace', publicIdentifier: 'ada' }] };
        }
        return { elements: [] };
      }),
    };
    const snapshot = await refreshInbound(
      store,
      http as JsonHttpGet,
      { getToken: async () => 'ajax:1' },
      now,
    );
    expect(snapshot.viewersStatus).toBe('unknown');
    expect(snapshot.messagesStatus).toBe('known');
    expect(snapshot.accepted).toEqual([
      {
        id: 'ada',
        name: 'Ada Lovelace',
        role: 'Engineer',
        kind: 'accepted',
        profileUrl: 'https://www.linkedin.com/in/ada',
      },
    ]);
    expect(await store.get(INBOX_ACCEPTED_KEY)).toMatchObject({ memberIds: ['ada'] });
    expect(await store.get(INBOX_SNAPSHOT_KEY)).toMatchObject({ acceptedStatus: 'known' });
  });
});

describe('draftsWaiting', () => {
  it('counts drafts that are neither approved nor a repost', async () => {
    const store = new FakeStore();
    const drafts: Draft[] = [
      draft('a', {}),
      draft('b', { approved: true }),
      draft('c', { kind: 'repost' }),
    ];
    await store.set(DRAFTS_KEY, drafts);
    await expect(draftsWaiting(store)).resolves.toBe(1);
  });
});

function draft(id: string, extra: Partial<Draft>): Draft {
  return {
    id,
    ideaTopic: id,
    ideaAngle: 'angle',
    text: 'text',
    createdAt: now.toISOString(),
    ...extra,
  };
}
