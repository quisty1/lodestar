import { describe, expect, it } from 'vitest';
import { FakeStore } from './fakeStore';

describe('FakeStore', () => {
  it('returns a copy so mutating the result does not change storage', async () => {
    const store = new FakeStore();
    const draft = { id: 'a', text: 'hello', approved: true };
    await store.set('content:drafts', [draft]);
    draft.text = 'changed-input';
    const loaded = await store.get<Array<{ text: string }>>('content:drafts');
    expect(loaded?.[0].text).toBe('hello');
    loaded![0].text = 'changed-output';
    const again = await store.get<Array<{ text: string }>>('content:drafts');
    expect(again?.[0].text).toBe('hello');
  });

  it('drops undefined fields and rejects functions and cycles', async () => {
    const store = new FakeStore();
    await store.set('shape', { kept: 1, missing: undefined });
    expect(await store.get('shape')).toEqual({ kept: 1 });
    await expect(store.set('fn', { run: () => 1 })).rejects.toThrow(/JSON-serializable/);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    await expect(store.set('cycle', cycle)).rejects.toThrow();
  });
});
