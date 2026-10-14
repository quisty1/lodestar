import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../ports';
import type { Draft, EffectDescriptor, EffectOutcome, EffectReceipt } from '../types';
import { CONNECT_DAY_BUDGET_KEY, CONNECT_WEEK_BUDGET_KEY } from '../connect/ConnectWeekBudget';
import {
  CONNECT_HISTORY_EFFECT_IDS_KEY,
  CONNECT_HISTORY_KEY,
  CONNECT_SENT_KEY,
  type ConnectRecord,
} from '../connect/ConnectHistory';
import { COMMENT_ACTED_KEY, COMMENT_BUDGET_KEY } from '../engagement/CommentDayBudget';
import { VIEW_DAY_BUDGET_KEY, VIEW_SEEN_KEY } from '../views/ViewDayBudget';
import {
  VIEW_HISTORY_EFFECT_IDS_KEY,
  VIEW_HISTORY_KEY,
  type ViewRecord,
} from '../views/ViewHistory';
import { POST_WEEK_BUDGET_KEY } from '../content/PostWeekBudget';
import { DRAFTS_KEY } from '../content/DraftStore';
import { EffectAccountant } from './EffectAccountant';

function memoryStore(initial: Record<string, unknown> = {}, failOnceAt?: string) {
  const values = new Map(Object.entries(initial));
  let failed = false;
  const store: KeyValueStore = {
    async get<T>(key: string) {
      return values.has(key) ? (values.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      if (key === failOnceAt && !failed) {
        failed = true;
        throw new Error(`crash:${key}`);
      }
      values.set(key, value);
    },
  };
  return { store, values };
}

const person = {
  memberId: 'member-1',
  name: 'Ada',
  headline: 'CTO',
  profileUrl: '/in/ada',
};

function receipt(
  effectId: string,
  descriptor: EffectDescriptor,
  outcome: EffectOutcome,
): EffectReceipt {
  return {
    effectId,
    requestId: `request-${effectId}`,
    descriptor,
    reservedAt: '2026-08-11T23:59:00.000Z',
    committedAt: '2026-08-12T00:00:00.000Z',
    settledAt: '2026-08-12T00:01:00.000Z',
    outcome,
    accounting: 'pending',
  };
}

const draft = (approved = true): Draft => ({
  id: 'draft-1',
  ideaTopic: 'topic',
  ideaAngle: 'angle',
  text: 'private text',
  createdAt: '2026-08-01T00:00:00.000Z',
  approved,
});

describe('EffectAccountant', () => {
  it.each(['confirmed', 'uncertain'] as const)(
    'comment %s consumes day cap and acted target once',
    async (outcome) => {
      const { store } = memoryStore();
      const accountant = new EffectAccountant(store);
      const effect = receipt(
        `comment-${outcome}`,
        { kind: 'comment', targetKey: 'post-1', postUrn: 'post-1' },
        outcome,
      );

      await accountant.apply(effect);
      await accountant.apply(effect);

      expect(await store.get(COMMENT_BUDGET_KEY)).toEqual({
        day: '2026-08-11',
        used: 1,
        effectIds: [effect.effectId],
      });
      expect(await store.get(COMMENT_ACTED_KEY)).toEqual(['post-1']);
    },
  );

  it('confirmed connect consumes week/day, sent-set and history exactly once', async () => {
    const { store } = memoryStore();
    const accountant = new EffectAccountant(store);
    const effect = receipt(
      'connect-confirmed',
      { kind: 'connect', targetKey: person.memberId, person },
      'confirmed',
    );

    await accountant.apply(effect);
    await accountant.apply(effect);

    expect(await store.get(CONNECT_WEEK_BUDGET_KEY)).toEqual({
      week: '2026-W33',
      used: 1,
      effectIds: [effect.effectId],
    });
    expect(await store.get(CONNECT_DAY_BUDGET_KEY)).toEqual({
      day: '2026-08-11',
      used: 1,
      effectIds: [effect.effectId],
    });
    expect(await store.get(CONNECT_SENT_KEY)).toEqual([person.memberId]);
    expect(await store.get(CONNECT_HISTORY_KEY)).toEqual([
      { ...person, sentAt: effect.settledAt, effectId: effect.effectId },
    ]);
  });

  it('uncertain connect reserves caps/sent-set but creates no confirmed history', async () => {
    const { store } = memoryStore();
    const effect = receipt(
      'connect-uncertain',
      { kind: 'connect', targetKey: person.memberId, person },
      'uncertain',
    );

    await new EffectAccountant(store).apply(effect);

    expect(await store.get<{ used: number }>(CONNECT_WEEK_BUDGET_KEY)).toMatchObject({ used: 1 });
    expect(await store.get<{ used: number }>(CONNECT_DAY_BUDGET_KEY)).toMatchObject({ used: 1 });
    expect(await store.get(CONNECT_SENT_KEY)).toEqual([person.memberId]);
    expect(await store.get(CONNECT_HISTORY_KEY)).toBeNull();
  });

  it('keeps ordinary acted/sent target sets capped while history tombstones remain durable', async () => {
    const oldTargets = Array.from({ length: 5_000 }, (_, index) => `old-${index}`);
    const { store } = memoryStore({
      [COMMENT_ACTED_KEY]: oldTargets,
      [CONNECT_SENT_KEY]: oldTargets,
    });
    const accountant = new EffectAccountant(store);

    await accountant.apply(
      receipt('comment-capped', { kind: 'comment', targetKey: 'new-comment' }, 'confirmed'),
    );
    await accountant.apply(
      receipt(
        'connect-capped',
        { kind: 'connect', targetKey: person.memberId, person },
        'uncertain',
      ),
    );

    expect(await store.get<string[]>(COMMENT_ACTED_KEY)).toHaveLength(5_000);
    expect(await store.get<string[]>(COMMENT_ACTED_KEY)).toEqual(
      expect.arrayContaining(['new-comment']),
    );
    expect(await store.get<string[]>(COMMENT_ACTED_KEY)).not.toContain('old-0');
    expect(await store.get<string[]>(CONNECT_SENT_KEY)).toHaveLength(5_000);
    expect(await store.get<string[]>(CONNECT_SENT_KEY)).toEqual(
      expect.arrayContaining([person.memberId]),
    );
    expect(await store.get<string[]>(CONNECT_SENT_KEY)).not.toContain('old-0');
  });

  it.each(['confirmed', 'uncertain'] as const)(
    'profile view %s reserves cap/seen and only confirmed adds history',
    async (outcome) => {
      const { store } = memoryStore();
      const effect = receipt(
        `view-${outcome}`,
        { kind: 'profile_view', targetKey: person.memberId, person },
        outcome,
      );

      await new EffectAccountant(store).apply(effect);

      expect(await store.get(VIEW_DAY_BUDGET_KEY)).toEqual({
        day: '2026-08-11',
        used: 1,
        effectIds: [effect.effectId],
      });
      expect(await store.get(VIEW_SEEN_KEY)).toEqual([person.memberId]);
      expect(await store.get(VIEW_HISTORY_KEY)).toEqual(
        outcome === 'confirmed'
          ? [
              {
                ...person,
                viewedAt: effect.settledAt,
                effectId: effect.effectId,
              },
            ]
          : null,
      );
    },
  );

  it('confirmed publish removes draft and uncertain publish unapproves it; both consume week', async () => {
    const confirmedStore = memoryStore({ [DRAFTS_KEY]: [draft()] }).store;
    const uncertainStore = memoryStore({ [DRAFTS_KEY]: [draft()] }).store;
    const confirmed = receipt(
      'publish-confirmed',
      { kind: 'publish', targetKey: 'draft-1', draftId: 'draft-1' },
      'confirmed',
    );
    const uncertain = receipt(
      'publish-uncertain',
      { kind: 'publish', targetKey: 'draft-1', draftId: 'draft-1' },
      'uncertain',
    );

    await new EffectAccountant(confirmedStore).apply(confirmed);
    await new EffectAccountant(uncertainStore).apply(uncertain);

    expect(await confirmedStore.get(DRAFTS_KEY)).toEqual([]);
    expect(await uncertainStore.get<Draft[]>(DRAFTS_KEY)).toEqual([draft(false)]);
    expect(await confirmedStore.get(POST_WEEK_BUDGET_KEY)).toMatchObject({
      used: 1,
      effectIds: ['publish-confirmed'],
    });
    expect(await uncertainStore.get(POST_WEEK_BUDGET_KEY)).toMatchObject({
      used: 1,
      effectIds: ['publish-uncertain'],
    });
  });

  it.each(['failed', 'cancelled', 'already'] as const)(
    '%s creates no external spend for every effect kind',
    async (outcome) => {
      const { store, values } = memoryStore();
      const descriptors: EffectDescriptor[] = [
        { kind: 'like', targetKey: 'post-like' },
        { kind: 'comment', targetKey: 'post-comment' },
        { kind: 'connect', targetKey: 'member-connect', person },
        { kind: 'profile_view', targetKey: 'member-view', person },
        { kind: 'publish', targetKey: 'draft-1', draftId: 'draft-1' },
      ];

      for (const [index, descriptor] of descriptors.entries()) {
        await new EffectAccountant(store).apply(
          receipt(`${outcome}-${index}`, descriptor, outcome),
        );
      }

      expect([...values.keys()]).toEqual([]);
    },
  );

  it.each(['confirmed', 'uncertain'] as const)(
    'like %s has no external sink (global safety is coordinator-atomic)',
    async (outcome) => {
      const { store, values } = memoryStore();
      await new EffectAccountant(store).apply(
        receipt(`like-${outcome}`, { kind: 'like', targetKey: 'post-1' }, outcome),
      );
      expect([...values.keys()]).toEqual([]);
    },
  );

  it('recovers a rejected queue tail and replays after a crash without double-spending completed sinks', async () => {
    const { store } = memoryStore({}, CONNECT_DAY_BUDGET_KEY);
    const accountant = new EffectAccountant(store);
    const effect = receipt(
      'connect-crash',
      { kind: 'connect', targetKey: person.memberId, person },
      'confirmed',
    );

    await expect(accountant.apply(effect)).rejects.toThrow(`crash:${CONNECT_DAY_BUDGET_KEY}`);
    expect(await store.get(CONNECT_WEEK_BUDGET_KEY)).toMatchObject({
      used: 1,
      effectIds: [effect.effectId],
    });
    await accountant.apply(effect);

    expect(await store.get(CONNECT_WEEK_BUDGET_KEY)).toMatchObject({
      used: 1,
      effectIds: [effect.effectId],
    });
    expect(await store.get(CONNECT_DAY_BUDGET_KEY)).toMatchObject({
      used: 1,
      effectIds: [effect.effectId],
    });
    expect(await store.get<unknown[]>(CONNECT_HISTORY_KEY)).toHaveLength(1);
  });

  it('serializes different receipts so concurrent accounting cannot lose an increment', async () => {
    const { store } = memoryStore();
    const accountant = new EffectAccountant(store);
    const secondPerson = {
      ...person,
      memberId: 'member-2',
      profileUrl: '/in/two',
    };

    await Promise.all([
      accountant.apply(
        receipt(
          'connect-one',
          { kind: 'connect', targetKey: person.memberId, person },
          'confirmed',
        ),
      ),
      accountant.apply(
        receipt(
          'connect-two',
          {
            kind: 'connect',
            targetKey: secondPerson.memberId,
            person: secondPerson,
          },
          'confirmed',
        ),
      ),
    ]);

    expect(await store.get(CONNECT_WEEK_BUDGET_KEY)).toMatchObject({ used: 2 });
    expect(await store.get(CONNECT_DAY_BUDGET_KEY)).toMatchObject({ used: 2 });
    expect(await store.get<unknown[]>(CONNECT_HISTORY_KEY)).toHaveLength(2);
  });

  it('shares one serializer across accountant instances using the same store', async () => {
    const { store } = memoryStore();
    const first = new EffectAccountant(store);
    const second = new EffectAccountant(store);
    const secondPerson = {
      ...person,
      memberId: 'member-2',
      profileUrl: '/in/two',
    };

    await Promise.all([
      first.apply(
        receipt(
          'connect-one',
          { kind: 'connect', targetKey: person.memberId, person },
          'confirmed',
        ),
      ),
      second.apply(
        receipt(
          'connect-two',
          {
            kind: 'connect',
            targetKey: secondPerson.memberId,
            person: secondPerson,
          },
          'confirmed',
        ),
      ),
    ]);

    expect(await store.get(CONNECT_WEEK_BUDGET_KEY)).toMatchObject({ used: 2 });
    expect(await store.get(CONNECT_DAY_BUDGET_KEY)).toMatchObject({ used: 2 });
    expect(await store.get<unknown[]>(CONNECT_HISTORY_KEY)).toHaveLength(2);
  });

  it('recovers the shared rejected tail for a second accountant instance', async () => {
    const { store } = memoryStore({}, CONNECT_DAY_BUDGET_KEY);
    const first = new EffectAccountant(store);
    const second = new EffectAccountant(store);
    const secondPerson = {
      ...person,
      memberId: 'member-2',
      profileUrl: '/in/two',
    };

    await expect(
      first.apply(
        receipt(
          'connect-one',
          { kind: 'connect', targetKey: person.memberId, person },
          'confirmed',
        ),
      ),
    ).rejects.toThrow(`crash:${CONNECT_DAY_BUDGET_KEY}`);
    await second.apply(
      receipt(
        'connect-two',
        {
          kind: 'connect',
          targetKey: secondPerson.memberId,
          person: secondPerson,
        },
        'confirmed',
      ),
    );

    expect(await store.get(CONNECT_WEEK_BUDGET_KEY)).toMatchObject({ used: 2 });
    expect(await store.get(CONNECT_DAY_BUDGET_KEY)).toMatchObject({ used: 1 });
  });

  it('keeps durable history tombstones after capped records are evicted', async () => {
    const { store } = memoryStore();
    const accountant = new EffectAccountant(store);
    const connect = receipt(
      'old-connect',
      { kind: 'connect', targetKey: person.memberId, person },
      'confirmed',
    );
    const view = receipt(
      'old-view',
      { kind: 'profile_view', targetKey: person.memberId, person },
      'confirmed',
    );
    await accountant.apply(connect);
    await accountant.apply(view);
    const connectFill = Array.from({ length: 500 }, (_, index): ConnectRecord => ({
      ...person,
      memberId: `connect-${index}`,
      sentAt: connect.settledAt,
      effectId: `connect-new-${index}`,
    }));
    const viewFill = Array.from({ length: 500 }, (_, index): ViewRecord => ({
      ...person,
      memberId: `view-${index}`,
      viewedAt: view.settledAt,
      effectId: `view-new-${index}`,
    }));
    await store.set(CONNECT_HISTORY_KEY, connectFill);
    await store.set(VIEW_HISTORY_KEY, viewFill);

    await accountant.apply(connect);
    await accountant.apply(view);

    expect(await store.get(CONNECT_HISTORY_EFFECT_IDS_KEY)).toContain(connect.effectId);
    expect(await store.get(VIEW_HISTORY_EFFECT_IDS_KEY)).toContain(view.effectId);
    expect(await store.get<ConnectRecord[]>(CONNECT_HISTORY_KEY)).toEqual(connectFill);
    expect(await store.get<ViewRecord[]>(VIEW_HISTORY_KEY)).toEqual(viewFill);
  });

  it('derives periods from reservedAt and never overwrites newer current counters', async () => {
    const { store } = memoryStore({
      [CONNECT_WEEK_BUDGET_KEY]: {
        week: '2026-W34',
        used: 7,
        effectIds: ['new'],
      },
      [CONNECT_DAY_BUDGET_KEY]: {
        day: '2026-08-18',
        used: 3,
        effectIds: ['new'],
      },
    });
    const effect = receipt(
      'late-connect',
      { kind: 'connect', targetKey: person.memberId, person },
      'confirmed',
    );

    await new EffectAccountant(store).apply(effect);

    expect(await store.get(CONNECT_WEEK_BUDGET_KEY)).toEqual({
      week: '2026-W34',
      used: 7,
      effectIds: ['new'],
    });
    expect(await store.get(CONNECT_DAY_BUDGET_KEY)).toEqual({
      day: '2026-08-18',
      used: 3,
      effectIds: ['new'],
    });
  });
});
