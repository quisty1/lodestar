import type { Clock, KeyValueStore } from '@lib/ports';
import { LinkedInAccountClient } from '@lib/linkedin/LinkedInAccountClient';
import { ensureLinkedInAccount } from '@lib/linkedin/ensureAccount';
import {
  restrictStorageToTrustedContexts,
  type StorageAccessLevelApi,
} from '@lib/linkedin/storageAccess';

export interface WorkerStorageBootstrap {
  local: StorageAccessLevelApi;
  store: KeyValueStore;
  client: LinkedInAccountClient;
  clock: Clock;
}

/** Closes storage.local to content scripts, then binds drafts and history to the signed-in account. */
export function bootstrapWorkerStorage(deps: WorkerStorageBootstrap): Promise<void> {
  return restrictStorageToTrustedContexts(deps.local).then(() =>
    ensureLinkedInAccount(deps).then(() => undefined),
  );
}
