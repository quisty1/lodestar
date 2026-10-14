import type { KeyValueStore } from '../ports';
import type { Draft } from '../types';
import { asArray } from '../engagement/settings';
import { ACCOUNT_KEY } from '../linkedin/account';

/** Storage key for the generated-post draft queue. */
export const DRAFTS_KEY = 'content:drafts';

/**
 * Persisted queue of generated post drafts. SRP: storage only —
 * generation lives in DraftGenerator. Reads guard the chrome.storage array-as-object
 * gotcha via asArray.
 */
export class DraftStore {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly store: KeyValueStore) {}

  async all(): Promise<Draft[]> {
    return asArray<Draft>(await this.store.get<Draft[]>(DRAFTS_KEY));
  }

  add(draft: Draft): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.all();
      current.unshift(await this.owned(draft));
      await this.store.set(DRAFTS_KEY, current);
    });
  }

  remove(id: string): Promise<void> {
    return this.enqueue(async () => {
      const next = (await this.all()).filter((draft) => draft.id !== id);
      await this.store.set(DRAFTS_KEY, next);
    });
  }

  update(id: string, text: string): Promise<void> {
    return this.enqueue(async () => {
      const next = (await this.all()).map((draft) =>
        draft.id === id ? { ...draft, text } : draft,
      );
      await this.store.set(DRAFTS_KEY, next);
    });
  }

  setApproved(id: string, approved: boolean): Promise<void> {
    return this.enqueue(async () => {
      const next = (await this.all()).map((draft) =>
        draft.id === id ? { ...draft, approved } : draft,
      );
      await this.store.set(DRAFTS_KEY, next);
    });
  }

  setMedia(id: string, mediaAttached: boolean): Promise<void> {
    return this.enqueue(async () => {
      const next = (await this.all()).map((draft) =>
        draft.id === id ? { ...draft, mediaAttached } : draft,
      );
      await this.store.set(DRAFTS_KEY, next);
    });
  }

  setKind(id: string, kind: Draft['kind']): Promise<void> {
    return this.enqueue(async () => {
      const next = (await this.all()).map((draft) =>
        draft.id === id ? { ...draft, kind } : draft,
      );
      await this.store.set(DRAFTS_KEY, next);
    });
  }

  private async owned(draft: Draft): Promise<Draft> {
    if (draft.accountId) return draft;
    const account = await this.store.get<{ id?: unknown }>(ACCOUNT_KEY);
    const id =
      account && typeof account.id === 'string' && account.id.length > 0 ? account.id : null;
    return id ? { ...draft, accountId: id } : draft;
  }

  private enqueue(mutation: () => Promise<void>): Promise<void> {
    const result = this.tail.then(mutation, mutation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
