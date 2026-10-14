import { describe, it, expect } from 'vitest';
import { DraftStore } from './DraftStore';
import type { KeyValueStore } from '@lib/ports';
import type { Draft } from '@lib/types';

function memStore(initial?: Record<string, unknown>): KeyValueStore {
  const m = new Map<string, unknown>(Object.entries(initial ?? {}));
  return {
    async get<T>(k: string) {
      return m.has(k) ? (m.get(k) as T) : null;
    },
    async set<T>(k: string, v: T) {
      m.set(k, v);
    },
  };
}

const d: Draft = {
  id: '1',
  ideaTopic: 'T',
  ideaAngle: 'A',
  text: 'post',
  createdAt: '2026-06-25T00:00:00Z',
};

describe('DraftStore', () => {
  it('adds and lists drafts', async () => {
    const s = new DraftStore(memStore());
    await s.add(d);
    expect(await s.all()).toEqual([d]);
  });

  it('removes by id', async () => {
    const s = new DraftStore(memStore());
    await s.add(d);
    await s.remove('1');
    expect(await s.all()).toEqual([]);
  });

  it('updates the text by id', async () => {
    const s = new DraftStore(memStore());
    await s.add(d);
    await s.update('1', 'edited');
    expect((await s.all())[0].text).toBe('edited');
  });

  it('survives chrome.storage serialising the array as an object', async () => {
    // chrome.storage returns {0:..,1:..} for arrays — asArray must rescue it.
    const s = new DraftStore(memStore({ 'content:drafts': { 0: d } }));
    expect(await s.all()).toEqual([d]);
  });

  it('sets and clears the approved flag, round-tripping through storage', async () => {
    const s = new DraftStore(memStore());
    await s.add(d);
    await s.setApproved('1', true);
    expect((await s.all())[0].approved).toBe(true);
    await s.setApproved('1', false);
    expect((await s.all())[0].approved).toBe(false);
  });

  it('setApproved on an unknown id is a no-op', async () => {
    const s = new DraftStore(memStore());
    await s.setApproved('nope', true); // must not throw
    expect(await s.all()).toEqual([]);
  });

  it('stamps the signed-in account onto a new draft', async () => {
    const s = new DraftStore(
      memStore({
        'linkedin:account': { id: 'acct-1', publicId: 'ada', capturedAt: '2026-06-01T00:00:00Z' },
      }),
    );
    await s.add(d);
    expect((await s.all())[0].accountId).toBe('acct-1');
  });
});
