import { DraftStore } from '@lib/content/DraftStore';
import {
  appendCommentJournal,
  COMMENT_JOURNAL_KEY,
  type CommentJournalEntry,
} from '@lib/engagement/commentJournal';
import { CONNECT_HISTORY_KEY, type ConnectRecord } from '@lib/connect/ConnectHistory';
import { matchAcceptedIds } from '@lib/connect/acceptRate';
import { asArray } from '@lib/engagement/settings';
import { readPeople } from '@lib/inbox/people';
import {
  INBOX_ACCEPTED_KEY,
  INBOX_SNAPSHOT_KEY,
  type AcceptedScan,
  type InboxSnapshot,
} from '@lib/inbox/snapshot';
import type { KeyValueStore } from '@lib/ports';
import type { JsonHttpGet, CsrfTokenProvider } from '@lib/ssi-api/contracts';

const VIEWERS_URL = 'https://www.linkedin.com/voyager/api/identity/wvmpCards';
const MESSAGES_URL =
  'https://www.linkedin.com/voyager/api/messaging/conversations?keyVersion=LEGACY_INBOX&count=20';
const CONNECTIONS_URL =
  'https://www.linkedin.com/voyager/api/relationships/connections?start=0&count=40';

export async function recordComment(
  store: KeyValueStore,
  entry: CommentJournalEntry,
): Promise<void> {
  const current = await store.get(COMMENT_JOURNAL_KEY);
  await store.set(COMMENT_JOURNAL_KEY, appendCommentJournal(current, entry));
}

export async function refreshInbound(
  store: KeyValueStore,
  http: JsonHttpGet,
  csrf: CsrfTokenProvider,
  now: Date,
): Promise<InboxSnapshot> {
  const token = await csrf.getToken();
  const headers = token
    ? {
        accept: 'application/vnd.linkedin.normalized+json+2.1',
        'csrf-token': token,
        'x-restli-protocol-version': '2.0.0',
      }
    : null;
  const viewers = headers
    ? await readUrl(http, VIEWERS_URL, headers, 'viewed')
    : { status: 'unknown' as const, people: [] };
  const messages = headers
    ? await readUrl(http, MESSAGES_URL, headers, 'messaged')
    : { status: 'unknown' as const, people: [] };
  const connections = headers
    ? await readUrl(http, CONNECTIONS_URL, headers, 'accepted')
    : { status: 'unknown' as const, people: [] };

  const snapshot: InboxSnapshot = {
    capturedAt: now.toISOString(),
    viewers: viewers.people,
    viewersStatus: viewers.status,
    messages: messages.people,
    messagesStatus: messages.status,
    accepted: [],
    acceptedStatus: connections.status,
  };

  if (connections.status === 'known') {
    const sent = asArray<ConnectRecord>(await store.get(CONNECT_HISTORY_KEY));
    const memberIds = matchAcceptedIds(
      sent,
      connections.people.map((person) => ({
        id: person.id,
        name: person.name,
        profileUrl: person.profileUrl,
      })),
    );
    const scan: AcceptedScan = { scannedAt: snapshot.capturedAt, memberIds };
    await store.set(INBOX_ACCEPTED_KEY, scan);
    const sentById = new Map(sent.map((record) => [record.memberId, record]));
    snapshot.accepted = memberIds.flatMap((id) => {
      const record = sentById.get(id);
      if (!record) return [];
      return [
        {
          id,
          name: record.name,
          role: record.headline,
          kind: 'accepted' as const,
          profileUrl: record.profileUrl,
        },
      ];
    });
  }

  await store.set(INBOX_SNAPSHOT_KEY, snapshot);
  return snapshot;
}

async function readUrl(
  http: JsonHttpGet,
  url: string,
  headers: Record<string, string>,
  kind: 'viewed' | 'messaged' | 'accepted',
) {
  try {
    const payload = await http.getJson<unknown>(url, headers);
    return readPeople(payload, kind);
  } catch {
    return { status: 'unknown' as const, people: [] };
  }
}

export async function draftsWaiting(store: KeyValueStore): Promise<number> {
  const drafts = await new DraftStore(store).all();
  return drafts.filter((draft) => draft.approved !== true && draft.kind !== 'repost').length;
}
