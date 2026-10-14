import { describe, expect, it, vi } from 'vitest';
import { FakeStore } from '@lib/storage/fakeStore';
import { bootstrapWorkerStorage } from './storageBootstrap';
import { LinkedInAccountClient } from '@lib/linkedin/LinkedInAccountClient';
import type { JsonHttpGet } from '@lib/ssi-api/contracts';

describe('bootstrapWorkerStorage', () => {
  it('restricts storage.local to TRUSTED_CONTEXTS before reading the account', async () => {
    const calls: string[] = [];
    const local = {
      setAccessLevel: vi.fn(async (options: { accessLevel: string }) => {
        calls.push(options.accessLevel);
      }),
    };
    const store = new FakeStore();
    const client = new LinkedInAccountClient(
      {
        getJson: (async () => {
          calls.push('fetch');
          return {
            miniProfile: {
              entityUrn: 'urn:li:member:1',
              publicIdentifier: 'ada',
            },
          };
        }) as JsonHttpGet['getJson'],
      },
      { getToken: async () => 'ajax:1' },
    );
    await bootstrapWorkerStorage({
      local,
      store,
      client,
      clock: { now: () => new Date('2026-10-08T12:00:00.000Z') },
    });
    expect(calls).toEqual(['TRUSTED_CONTEXTS', 'fetch']);
  });
});
