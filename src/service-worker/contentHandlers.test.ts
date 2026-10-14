import { describe, it, expect, vi } from 'vitest';
import {
  commentOnPost,
  extractRunIdeas,
  generateDraft,
  generateIdeas,
  publishApprovedDrafts,
} from './contentHandlers';
import { IDEAS_LAST_RUN_KEY } from '@lib/ideas/IdeaDayBudget';
import type { IdeasLastRun } from '@lib/types';
import type { KeyValueStore, Clock } from '@lib/ports';
import { DraftStore } from '@lib/content/DraftStore';
import { isoWeekKey } from '@lib/content/PostWeekBudget';
import type { HttpClient, HttpGet } from '@lib/llm/contracts';
import type { FeedPost } from '@lib/types';

function memStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const m = new Map<string, unknown>(Object.entries(initial));
  return {
    async get<T>(k: string) {
      return m.has(k) ? (m.get(k) as T) : null;
    },
    async set<T>(k: string, v: T) {
      m.set(k, v);
    },
  };
}

/** Returns a real-shape OpenRouter completion whose content is `text`. */
function fakeHttp(text: string): HttpClient & HttpGet {
  return {
    async postJson<T>() {
      return { choices: [{ message: { content: text } }] } as T;
    },
    async getJson<T>() {
      return {} as T;
    },
  };
}

function deferred<T>() {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next as (value?: T | PromiseLike<T>) => void;
  });
  return { promise, resolve };
}

const CONFIGURED = {
  'llm:config': { provider: 'openrouter', apiKey: 'sk-1' },
  'engagement:settings': {
    config: { level: 'manual' },
    target: { stack: [] },
    expertise: { headline: 'Frontend TechLead', stack: ['Vue'] },
    relevanceThreshold: 0.3,
  },
};

const fixedClock: Clock = { now: () => new Date('2026-06-25T00:00:00.000Z') };

const posts: FeedPost[] = [{ urn: 'urn:1', authorName: 'A', text: 'hiring vue devs' }];
// ≥ MIN_IDEA_BUFFER (5) so extraction proceeds; SPARK_JSON sourceIndex is 1-based → maps to
// bufferPosts[0], so keep author 'A'/urn:1 first for the spark assertion.
const bufferPosts: FeedPost[] = [
  { urn: 'urn:1', authorName: 'A', text: 'hiring vue devs' },
  { urn: 'urn:2', authorName: 'B', text: 'post 2' },
  { urn: 'urn:3', authorName: 'C', text: 'post 3' },
  { urn: 'urn:4', authorName: 'D', text: 'post 4' },
  { urn: 'urn:5', authorName: 'E', text: 'post 5' },
];

describe('generateDraft', () => {
  it('errors no_key when the key is empty', async () => {
    const res = await generateDraft(
      {
        store: memStore(),
        http: fakeHttp('x'),
        clock: fixedClock,
        newId: () => 'id1',
      },
      { topic: 'T', angle: 'A' },
    );
    expect(res).toEqual({ draft: null, error: 'no_key' });
  });

  it('generates a post via the LLM and stores the draft', async () => {
    const store = memStore(CONFIGURED);
    const res = await generateDraft(
      {
        store,
        http: fakeHttp('My post body.'),
        clock: fixedClock,
        newId: () => 'id1',
      },
      { topic: 'tRPC vs REST', angle: 'type-safety from Vue' },
    );
    expect(res.error).toBeUndefined();
    expect(res.draft).toEqual({
      id: 'id1',
      ideaTopic: 'tRPC vs REST',
      ideaAngle: 'type-safety from Vue',
      text: 'My post body.',
      createdAt: '2026-06-25T00:00:00.000Z',
      mediaAttached: false,
      kind: 'post',
    });
    expect(await store.get('content:drafts')).toEqual([res.draft]);
  });
});

describe('generateIdeas', () => {
  it('errors no_key when the key is empty', async () => {
    const res = await generateIdeas({
      store: memStore(),
      http: fakeHttp('[]'),
      harvest: async () => posts,
    });
    expect(res).toEqual({ ideas: [], error: 'no_key' });
  });

  it('errors no_expertise when the headline is blank', async () => {
    const store = memStore({
      'llm:config': { provider: 'openrouter', apiKey: 'sk-1' },
    });
    const res = await generateIdeas({
      store,
      http: fakeHttp('[]'),
      harvest: async () => posts,
    });
    expect(res).toEqual({ ideas: [], error: 'no_expertise' });
  });

  it('errors no_feed when harvest is empty', async () => {
    const res = await generateIdeas({
      store: memStore(CONFIGURED),
      http: fakeHttp('[]'),
      harvest: async () => [],
    });
    expect(res).toEqual({ ideas: [], error: 'no_feed' });
  });

  it('extracts ideas via the LLM and banks them', async () => {
    const ideasJson = JSON.stringify([{ topic: 'tRPC vs REST', angle: 'type-safety from Vue' }]);
    const store = memStore(CONFIGURED);
    const res = await generateIdeas({
      store,
      http: fakeHttp(ideasJson),
      harvest: async () => posts,
    });
    expect(res.error).toBeUndefined();
    expect(res.ideas).toContainEqual({
      topic: 'tRPC vs REST',
      angle: 'type-safety from Vue',
    });
    // persisted to the bank
    expect(await store.get('ideas:bank')).toEqual([
      { topic: 'tRPC vs REST', angle: 'type-safety from Vue' },
    ]);
  });
});

const CONTENT_MODS = {
  'modules:state': [
    {
      id: 'content',
      enabled: true,
      available: true,
      automationLevel: 'manual',
      dailyLimit: 5,
    },
  ],
};
const SPARK_JSON = JSON.stringify([
  {
    topic: 'Architecture',
    angle: 'Pragmatism',
    sourceIndex: 1,
    claim: 'Speed over purity',
    quote: 'ship fast',
  },
]);

describe('extractRunIdeas (LLM boundary)', () => {
  it('banks sparked ideas from the supplied buffer and records the day budget', async () => {
    const store = memStore({ ...CONFIGURED, ...CONTENT_MODS });
    const res = await extractRunIdeas(
      { store, http: fakeHttp(SPARK_JSON), clock: fixedClock },
      bufferPosts,
    );
    expect(res.stored).toBe(1);
    const bank = (await store.get('ideas:bank')) as any[];
    expect(bank[0].spark.source).toEqual({ author: 'A', id: 'urn:1' });
    expect(await store.get('ideas:budget')).toEqual({
      day: '2026-06-25',
      used: 1,
    });
  });

  it('errors no_key without calling the model when the key is empty', async () => {
    const store = memStore({ ...CONTENT_MODS });
    expect(
      await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, posts),
    ).toEqual({
      stored: 0,
      error: 'no_key',
    });
  });

  it('skips extraction (stored:0) when the daily budget is exhausted', async () => {
    const store = memStore({
      ...CONFIGURED,
      ...CONTENT_MODS,
      'ideas:budget': { day: '2026-06-25', used: 5 },
    });
    expect(
      await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, bufferPosts),
    ).toEqual({ stored: 0 });
  });

  it('records ideas:lastRun=thin_feed (no LLM call) when the buffer is below MIN_IDEA_BUFFER', async () => {
    const store = memStore({ ...CONFIGURED, ...CONTENT_MODS });
    const res = await extractRunIdeas(
      { store, http: fakeHttp(SPARK_JSON), clock: fixedClock },
      posts,
    ); // 1 post < 5
    expect(res).toEqual({ stored: 0 });
    const last = (await store.get(IDEAS_LAST_RUN_KEY)) as IdeasLastRun;
    expect(last.reason).toBe('thin_feed');
    expect(last.posts).toBe(1);
    expect(await store.get('ideas:bank')).toBeNull(); // anti-slop: nothing banked from a thin buffer
  });

  it('returns stored:0 (no extraction) when the content module is disabled', async () => {
    const store = memStore({
      ...CONFIGURED,
      'modules:state': [
        {
          id: 'content',
          enabled: false,
          available: true,
          automationLevel: 'manual',
          dailyLimit: 5,
        },
      ],
    });
    expect(
      await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, posts),
    ).toEqual({ stored: 0 });
  });

  it('errors no_expertise when the headline is blank', async () => {
    const store = memStore({
      'llm:config': { provider: 'openrouter', apiKey: 'sk-1' },
      ...CONTENT_MODS,
    });
    expect(
      await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, posts),
    ).toEqual({
      stored: 0,
      error: 'no_expertise',
    });
  });

  it('records ideas:lastRun=ok with the stored count + budget on success', async () => {
    const store = memStore({ ...CONFIGURED, ...CONTENT_MODS });
    await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, bufferPosts);
    const last = (await store.get(IDEAS_LAST_RUN_KEY)) as IdeasLastRun;
    expect(last.reason).toBe('ok');
    expect(last.stored).toBe(1);
    expect(last.budget).toEqual({ used: 1, limit: 5 });
    expect(typeof last.at).toBe('string');
  });

  it('records ideas:lastRun=budget_exhausted (with counts) instead of a silent skip', async () => {
    const store = memStore({
      ...CONFIGURED,
      ...CONTENT_MODS,
      'ideas:budget': { day: '2026-06-25', used: 5 },
    });
    await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, bufferPosts);
    const last = (await store.get(IDEAS_LAST_RUN_KEY)) as IdeasLastRun;
    expect(last.reason).toBe('budget_exhausted');
    expect(last.budget).toEqual({ used: 5, limit: 5 });
    expect(last.stored).toBe(0);
  });

  it('records ideas:lastRun=error with the provider/parse message when extraction throws', async () => {
    const store = memStore({ ...CONFIGURED, ...CONTENT_MODS });
    await extractRunIdeas(
      {
        store,
        http: fakeHttp('sorry, here are some ideas as prose'),
        clock: fixedClock,
      },
      bufferPosts,
    );
    const last = (await store.get(IDEAS_LAST_RUN_KEY)) as IdeasLastRun;
    expect(last.reason).toBe('error');
    expect(typeof last.error).toBe('string');
    expect(last.stored).toBe(0);
  });

  it('persists no ideas, budget or completion marker when STOP lands during the LLM response', async () => {
    const store = memStore({ ...CONFIGURED, ...CONTENT_MODS });
    const started = deferred<undefined>();
    const completion = deferred<unknown>();
    let stopped = false;
    const http: HttpClient & HttpGet = {
      async postJson<T>() {
        started.resolve();
        return (await completion.promise) as T;
      },
      async getJson<T>() {
        return {} as T;
      },
    };
    const extraction = extractRunIdeas(
      { store, http, clock: fixedClock, cancelled: async () => stopped },
      bufferPosts,
    );
    await started.promise;
    stopped = true;
    completion.resolve({ choices: [{ message: { content: SPARK_JSON } }] });

    expect(await extraction).toEqual({ stored: 0, error: 'cancelled' });
    expect(await store.get('ideas:bank')).toBeNull();
    expect(await store.get('ideas:budget')).toBeNull();
    expect(await store.get(IDEAS_LAST_RUN_KEY)).toBeNull();
  });
});

const RELEVANT_POST: FeedPost = {
  urn: 'urn:c',
  authorName: 'Anna',
  authorHeadline: 'Technical recruiter',
  text: 'we are hiring vue engineers',
};
const COMMENT_CFG = {
  'llm:config': { provider: 'openrouter', apiKey: 'sk-1' },
  'engagement:settings': {
    config: { level: 'manual' },
    target: {
      stack: ['vue'],
      targetRoles: ['recruiter'],
      geos: [],
      watchlistCompanies: [],
    },
    expertise: { headline: 'Vue TechLead', stack: ['Vue'] },
    relevanceThreshold: 0.3,
  },
  'content:settings': {
    commentsEnabled: true,
    commentsPerDay: 5,
    commentTone: 'expert',
  },
};
const COMMENT_TEXT = 'Sharp, specific take from my own Vue experience here.';

describe('commentOnPost (LLM boundary)', () => {
  it('generates + judges a comment without spending budget before DOM settlement', async () => {
    const store = memStore({ ...COMMENT_CFG });
    const res = await commentOnPost(
      { store, http: fakeHttp(COMMENT_TEXT), clock: fixedClock },
      RELEVANT_POST,
    );
    expect(res.ok).toBe(true);
    expect(res.text).toContain('Vue');
    expect(await store.get('comments:budget')).toBeNull();
  });

  it('skips when comments are disabled', async () => {
    const store = memStore({
      ...COMMENT_CFG,
      'content:settings': { commentsEnabled: false },
    });
    expect(
      (await commentOnPost({ store, http: fakeHttp('x'), clock: fixedClock }, RELEVANT_POST)).ok,
    ).toBe(false);
  });

  it('comments on an OFF-target post too — engagement over niche relevance (SSI = activity)', async () => {
    // No stack-relevance gate anymore: any liked post gets a clarifying-question comment.
    const store = memStore({ ...COMMENT_CFG });
    const offtopic: FeedPost = {
      urn: 'o',
      authorName: 'B',
      text: 'nice weather today everyone',
    };
    const res = await commentOnPost(
      { store, http: fakeHttp(COMMENT_TEXT), clock: fixedClock },
      offtopic,
    );
    expect(res.ok).toBe(true);
    expect(res.reason).not.toBe('not_relevant');
  });

  it('skips when the daily comment budget is exhausted', async () => {
    const store = memStore({
      ...COMMENT_CFG,
      'comments:budget': { day: '2026-06-25', used: 5 },
    });
    expect(
      await commentOnPost({ store, http: fakeHttp('x'), clock: fixedClock }, RELEVANT_POST),
    ).toEqual({
      ok: false,
      reason: 'budget',
    });
  });

  it('does not generate a second comment for a ledger-accounted post', async () => {
    const postJson = vi.fn();
    const http: HttpClient & HttpGet = {
      postJson,
      getJson: async <T>() => ({}) as T,
    };
    const store = memStore({
      ...COMMENT_CFG,
      'comments:acted': [RELEVANT_POST.urn],
    });

    expect(await commentOnPost({ store, http, clock: fixedClock }, RELEVANT_POST)).toEqual({
      ok: false,
      reason: 'already',
    });
    expect(postJson).not.toHaveBeenCalled();
  });

  it('does not consume comment budget when STOP lands during the LLM response', async () => {
    const store = memStore({ ...COMMENT_CFG });
    const started = deferred<undefined>();
    const completion = deferred<unknown>();
    let stopped = false;
    const http: HttpClient & HttpGet = {
      async postJson<T>() {
        started.resolve();
        return (await completion.promise) as T;
      },
      async getJson<T>() {
        return {} as T;
      },
    };
    const comment = commentOnPost(
      { store, http, clock: fixedClock, cancelled: async () => stopped },
      RELEVANT_POST,
    );
    await started.promise;
    stopped = true;
    completion.resolve({ choices: [{ message: { content: COMMENT_TEXT } }] });

    expect(await comment).toEqual({ ok: false, reason: 'cancelled' });
    expect(await store.get('comments:budget')).toBeNull();
  });
});

/** Captures each postJson body so we can assert what reached the LLM wire. */
function capturingHttp(text = 'A specific, real take from my own Vue experience here.'): {
  http: HttpClient & HttpGet;
  bodies: unknown[];
} {
  const bodies: unknown[] = [];
  return {
    bodies,
    http: {
      async postJson<T>(_url: string, body: unknown) {
        bodies.push(body);
        return { choices: [{ message: { content: text } }] } as T;
      },
      async getJson<T>() {
        return {} as T;
      },
    },
  };
}

const allDays = {
  'content:settings': { publishDays: [0, 1, 2, 3, 4, 5, 6], postsPerWeek: 3 },
  'linkedin:account': { id: 'acct-1', publicId: 'ada', capturedAt: '2026-06-01T00:00:00Z' },
};
const approvedDraft = {
  id: 'a',
  ideaTopic: 't',
  ideaAngle: 'g',
  text: 'hello',
  createdAt: '2026-06-01T00:00:00Z',
  approved: true,
  accountId: 'acct-1',
};
const clock = { now: () => new Date('2026-06-26T10:00:00Z') };

describe('publishApprovedDrafts', () => {
  it('passes the oldest approved draft to the executor without mutating ledger-owned sinks', async () => {
    const store = memStore({
      ...CONTENT_MODS,
      ...allDays,
      'content:drafts': [approvedDraft],
    });
    let prepared = false;
    const r = await publishApprovedDrafts({
      store,
      clock,
      prepare: async () => {
        prepared = true;
      },
      publish: async (_text, draft) => {
        expect(draft).toEqual(approvedDraft);
        return { ok: true };
      },
    });
    expect(r).toMatchObject({ published: 1, reason: 'done' });
    expect(prepared).toBe(true);
    expect(await new DraftStore(store).all()).toEqual([approvedDraft]);
    expect(await store.get('posts:budget')).toBeNull();
  });

  it('does not reserve an effect when the LinkedIn account is unknown', async () => {
    const store = memStore({
      ...CONTENT_MODS,
      'content:settings': allDays['content:settings'],
      'content:drafts': [approvedDraft],
    });
    let prepared = false;
    const r = await publishApprovedDrafts({
      store,
      clock,
      prepare: async () => {
        prepared = true;
      },
      publish: async () => ({ ok: true }),
    });
    expect(r).toEqual({ published: 0, reason: 'account_unknown' });
    expect(prepared).toBe(false);
  });

  it('does not reserve an effect when the draft belongs to another account', async () => {
    const store = memStore({
      ...CONTENT_MODS,
      ...allDays,
      'content:drafts': [{ ...approvedDraft, accountId: 'other' }],
    });
    let prepared = false;
    const r = await publishApprovedDrafts({
      store,
      clock,
      prepare: async () => {
        prepared = true;
      },
      publish: async () => ({ ok: true }),
    });
    expect(r).toEqual({ published: 0, reason: 'wrong_account' });
    expect(prepared).toBe(false);
  });

  it('does NOT publish (or prepare) when today is not a publish day', async () => {
    const store = memStore({
      ...CONTENT_MODS,
      'content:settings': { publishDays: [], postsPerWeek: 3 },
      'content:drafts': [approvedDraft],
    });
    let prepared = false;
    const r = await publishApprovedDrafts({
      store,
      clock,
      prepare: async () => {
        prepared = true;
      },
      publish: async () => ({ ok: true }),
    });
    expect(r).toEqual({ published: 0, reason: 'not_publish_day' });
    expect(prepared).toBe(false);
    expect((await new DraftStore(store).all()).length).toBe(1); // kept
  });

  it('skips when there is no approved draft', async () => {
    const store = memStore({
      ...CONTENT_MODS,
      ...allDays,
      'content:drafts': [{ ...approvedDraft, approved: false }],
    });
    const r = await publishApprovedDrafts({
      store,
      clock,
      prepare: async () => {},
      publish: async () => ({ ok: true }),
    });
    expect(r).toEqual({ published: 0, reason: 'no_approved_draft' });
  });

  it('skips when the weekly cap is exhausted', async () => {
    const store = memStore({
      ...CONTENT_MODS,
      ...allDays,
      'content:drafts': [approvedDraft],
      'posts:budget': { week: isoWeekKey(clock.now()), used: 3 },
    });
    const r = await publishApprovedDrafts({
      store,
      clock,
      prepare: async () => {},
      publish: async () => ({ ok: true }),
    });
    expect(r).toEqual({ published: 0, reason: 'weekly_cap' });
  });

  it('skips with reason disabled when the content module is off', async () => {
    const store = memStore({
      'modules:state': [
        {
          id: 'content',
          enabled: false,
          available: true,
          automationLevel: 'manual',
          dailyLimit: 5,
        },
      ],
      ...allDays,
      'content:drafts': [approvedDraft],
    });
    const r = await publishApprovedDrafts({
      store,
      clock,
      prepare: async () => {},
      publish: async () => ({ ok: true }),
    });
    expect(r).toEqual({ published: 0, reason: 'disabled' });
  });

  it('keeps the draft + reports reason when the composer publish fails', async () => {
    const store = memStore({
      ...CONTENT_MODS,
      ...allDays,
      'content:drafts': [approvedDraft],
    });
    const r = await publishApprovedDrafts({
      store,
      clock,
      prepare: async () => {},
      publish: async () => ({ ok: false, reason: 'post_button_disabled' }),
    });
    expect(r).toEqual({ published: 0, reason: 'post_button_disabled' });
    expect((await new DraftStore(store).all()).length).toBe(1);
  });

  it('leaves uncertain publish accounting to the durable ledger', async () => {
    // undefined = channel closed (SW eviction/nav) AFTER the post may already be live.
    // Must NOT leave the draft auto-eligible → next run would duplicate a public post.
    const store = memStore({
      ...CONTENT_MODS,
      ...allDays,
      'content:drafts': [approvedDraft],
    });
    const r = await publishApprovedDrafts({
      store,
      clock,
      prepare: async () => {},
      publish: async () => undefined,
    });
    expect(r).toEqual({ published: 0, reason: 'uncertain' });
    const all = await new DraftStore(store).all();
    expect(all.length).toBe(1); // kept (not lost — human reconciles)
    expect(all[0].approved).toBe(true);
    expect(await store.get('posts:budget')).toBeNull();
  });

  it('reports an acknowledged uncertain publish as zero executed while safety is spent', async () => {
    const store = memStore({
      ...CONTENT_MODS,
      ...allDays,
      'content:drafts': [approvedDraft],
    });
    const r = await publishApprovedDrafts({
      store,
      clock,
      prepare: async () => {},
      publish: async () => ({
        ok: false,
        safetySpent: true,
        reason: 'modal_did_not_close',
      }),
    });

    expect(r).toEqual({ published: 0, reason: 'uncertain' });
  });

  it('does not click publish or mutate draft/budget when STOP lands during prepare', async () => {
    const store = memStore({
      ...CONTENT_MODS,
      ...allDays,
      'content:drafts': [approvedDraft],
    });
    let stopped = false;
    const publish = vi.fn(async () => ({ ok: true }));

    const result = await publishApprovedDrafts({
      store,
      clock,
      cancelled: async () => stopped,
      prepare: async () => {
        stopped = true;
      },
      publish,
    });

    expect(result).toEqual({ published: 0, reason: 'cancelled' });
    expect(publish).not.toHaveBeenCalled();
    expect(await new DraftStore(store).all()).toEqual([approvedDraft]);
    expect(await store.get('posts:budget')).toBeNull();
  });
});

describe('content language reaches the LLM wire', () => {
  it('generateDraft injects the configured language into the post request', async () => {
    const { http, bodies } = capturingHttp('My post body.');
    const store = memStore({
      ...CONFIGURED,
      'content:settings': { contentLanguage: 'en' },
    });
    await generateDraft(
      { store, http, clock: fixedClock, newId: () => 'id1' },
      { topic: 'T', angle: 'A' },
    );
    expect(JSON.stringify(bodies[0])).toMatch(/English/);
  });

  it('commentOnPost injects the configured language into the comment request', async () => {
    const { http, bodies } = capturingHttp();
    const store = memStore({
      ...COMMENT_CFG,
      'content:settings': {
        commentsEnabled: true,
        commentsPerDay: 5,
        commentTone: 'expert',
        contentLanguage: 'en',
      },
    });
    await commentOnPost({ store, http, clock: fixedClock }, RELEVANT_POST);
    expect(JSON.stringify(bodies[0])).toMatch(/English/);
  });
});
