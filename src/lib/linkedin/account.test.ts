import { describe, expect, it, vi } from 'vitest';
import { FakeStore } from '../storage/fakeStore';
import {
  readLinkedInAccount,
  ACCOUNT_KEY,
  MIGRATED_ACCOUNT_KEY,
  accountStorageKey,
} from './account';
import { migrateLegacyAccount } from './migrateAccount';
import { ensureLinkedInAccount } from './ensureAccount';
import { LinkedInAccountClient, LINKEDIN_ME_URL } from './LinkedInAccountClient';
import type { JsonHttpGet } from '../ssi-api/contracts';

const clock = { now: () => new Date('2026-10-08T12:00:00.000Z') };
const ada = {
  id: 'urn:li:member:1',
  publicId: 'ada',
  capturedAt: '2026-10-08T12:00:00.000Z',
};

describe('readLinkedInAccount', () => {
  it('reads the member urn and vanity from miniProfile', () => {
    expect(
      readLinkedInAccount(
        {
          data: {
            miniProfile: {
              entityUrn: 'urn:li:member:1',
              publicIdentifier: 'ada',
            },
          },
        },
        ada.capturedAt,
      ),
    ).toEqual(ada);
  });

  it('falls back to plainId when the urn is missing', () => {
    expect(
      readLinkedInAccount(
        {
          publicIdentifier: 'ada',
          data: { plainId: 42 },
        },
        ada.capturedAt,
      ),
    ).toEqual({ ...ada, id: '42' });
  });

  it('returns null when the vanity is missing', () => {
    expect(readLinkedInAccount({ entityUrn: 'urn:li:member:1' }, ada.capturedAt)).toBeNull();
  });
});

describe('LinkedInAccountClient', () => {
  it('sends the CSRF header and maps /voyager/api/me', async () => {
    const getJson = vi.fn(async () => ({
      miniProfile: { entityUrn: ada.id, publicIdentifier: ada.publicId },
    }));
    const client = new LinkedInAccountClient(
      { getJson: getJson as unknown as JsonHttpGet['getJson'] },
      { getToken: async () => 'ajax:1' },
    );
    await expect(client.fetchAccount(ada.capturedAt)).resolves.toEqual(ada);
    expect(getJson).toHaveBeenCalledWith(
      LINKEDIN_ME_URL,
      expect.objectContaining({
        'csrf-token': 'ajax:1',
      }),
    );
  });

  it('returns null without a session token', async () => {
    const getJson = vi.fn();
    const client = new LinkedInAccountClient({ getJson: getJson }, { getToken: async () => null });
    await expect(client.fetchAccount(ada.capturedAt)).resolves.toBeNull();
    expect(getJson).not.toHaveBeenCalled();
  });
});

describe('account migration', () => {
  it('copies legacy keys once into the first account and stamps drafts', async () => {
    const store = new FakeStore();
    await store.set('content:drafts', [{ id: 'd1', text: 'hi' }]);
    await store.set('connects:sent', ['m1']);
    await store.set('llm:config', { key: 'secret' });
    await migrateLegacyAccount(store, ada);
    expect(await store.get(accountStorageKey(ada.id, 'content:drafts'))).toEqual([
      { id: 'd1', text: 'hi', accountId: ada.id },
    ]);
    expect(await store.get(accountStorageKey(ada.id, 'connects:sent'))).toEqual(['m1']);
    expect(await store.get('llm:config')).toEqual({ key: 'secret' });
    expect(await store.get(MIGRATED_ACCOUNT_KEY)).toBe(ada.id);
    await store.set('content:drafts', [{ id: 'later' }]);
    await migrateLegacyAccount(store, {
      ...ada,
      id: 'urn:li:member:2',
      publicId: 'grace',
    });
    expect(await store.get(accountStorageKey('urn:li:member:2', 'content:drafts'))).toBeNull();
  });

  it('keeps the stored account when the network read fails', async () => {
    const store = new FakeStore();
    await store.set(ACCOUNT_KEY, ada);
    const client = new LinkedInAccountClient(
      {
        getJson: async () => {
          throw new Error('offline');
        },
      },
      { getToken: async () => 'ajax:1' },
    );
    await expect(ensureLinkedInAccount({ store, client, clock })).resolves.toEqual(ada);
  });

  it('switches account without copying the previous history', async () => {
    const store = new FakeStore();
    await store.set(ACCOUNT_KEY, ada);
    await store.set(MIGRATED_ACCOUNT_KEY, ada.id);
    await store.set(accountStorageKey(ada.id, 'connects:sent'), ['m1']);
    const grace = { ...ada, id: 'urn:li:member:2', publicId: 'grace' };
    const client = new LinkedInAccountClient(
      {
        getJson: (async () => ({
          miniProfile: {
            entityUrn: grace.id,
            publicIdentifier: grace.publicId,
          },
        })) as JsonHttpGet['getJson'],
      },
      { getToken: async () => 'ajax:1' },
    );
    await expect(ensureLinkedInAccount({ store, client, clock })).resolves.toMatchObject({
      id: grace.id,
    });
    expect(await store.get(accountStorageKey(grace.id, 'connects:sent'))).toBeNull();
    expect(await store.get(ACCOUNT_KEY)).toMatchObject({ id: grace.id });
  });
});
