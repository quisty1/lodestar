import { describe, it, expect } from 'vitest';
import { IdeaBank } from './IdeaBank';
import type { KeyValueStore } from '@lib/ports';
import type { Idea } from '@lib/types';

function memStore(): KeyValueStore {
  const m = new Map<string, unknown>();
  return {
    async get<T>(k: string) {
      return m.has(k) ? (m.get(k) as T) : null;
    },
    async set<T>(k: string, v: T) {
      m.set(k, v);
    },
  };
}

const a: Idea = { topic: 'tRPC vs REST', angle: 'type-safety from a Vue codebase' };
const b: Idea = { topic: 'AI code review', angle: 'what it misses vs a senior' };

describe('IdeaBank', () => {
  it('stores and returns ideas in insertion order', async () => {
    const bank = new IdeaBank(memStore());
    await bank.add([a, b]);
    expect(await bank.all()).toEqual([a, b]);
  });

  it('returns newest-first for display (most recently added on top)', async () => {
    const bank = new IdeaBank(memStore());
    await bank.add([a]);
    await bank.add([b]);
    expect(await bank.allNewestFirst()).toEqual([b, a]);
  });

  it('deduplicates by topic+angle (case/space-insensitive)', async () => {
    const bank = new IdeaBank(memStore());
    await bank.add([a]);
    await bank.add([{ topic: '  TRPC vs REST ', angle: 'Type-safety from a Vue codebase' }]);
    expect(await bank.all()).toEqual([a]);
  });

  it('appends only the new ideas on a later harvest', async () => {
    const bank = new IdeaBank(memStore());
    await bank.add([a]);
    await bank.add([a, b]);
    expect(await bank.all()).toEqual([a, b]);
  });

  it('persists across instances sharing a store', async () => {
    const store = memStore();
    await new IdeaBank(store).add([a]);
    expect(await new IdeaBank(store).all()).toEqual([a]);
  });

  it('clears the bank', async () => {
    const bank = new IdeaBank(memStore());
    await bank.add([a, b]);
    await bank.clear();
    expect(await bank.all()).toEqual([]);
  });

  it('removes an idea by topic+angle (normalised)', async () => {
    const bank = new IdeaBank(memStore());
    await bank.add([a, b]);
    await bank.remove({ topic: '  TRPC vs REST ', angle: 'Type-safety from a Vue codebase' });
    expect(await bank.all()).toEqual([b]);
  });
});
