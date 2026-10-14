import type { KeyValueStore } from '../ports';
import type { Idea } from '../types';
import { asArray } from '../engagement/settings';

/** Storage key for the persisted idea bank. */
export const IDEA_BANK_KEY = 'ideas:bank';

/**
 * Persisted bank of content ideas. Appends new ideas across
 * harvests and dedupes by topic+angle (normalised) so the same trend doesn't pile
 * up. SRP: storage of ideas only — extraction lives in IdeaExtractor.
 */
export class IdeaBank {
  constructor(private readonly store: KeyValueStore) {}

  async add(ideas: Idea[]): Promise<void> {
    const current = await this.all();
    const seen = new Set(current.map(key));
    for (const idea of ideas) {
      const k = key(idea);
      if (!seen.has(k)) {
        current.push(idea);
        seen.add(k);
      }
    }
    await this.store.set(IDEA_BANK_KEY, current);
  }

  async all(): Promise<Idea[]> {
    return asArray<Idea>(await this.store.get<Idea[]>(IDEA_BANK_KEY));
  }

  /** Ideas newest-first (most recently added on top) — display order for the UI. */
  async allNewestFirst(): Promise<Idea[]> {
    return (await this.all()).reverse();
  }

  async remove(idea: Idea): Promise<void> {
    const target = key(idea);
    const next = (await this.all()).filter((i) => key(i) !== target);
    await this.store.set(IDEA_BANK_KEY, next);
  }

  async clear(): Promise<void> {
    await this.store.set(IDEA_BANK_KEY, []);
  }
}

function key(idea: Idea): string {
  return `${norm(idea.topic)}::${norm(idea.angle)}`;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}
