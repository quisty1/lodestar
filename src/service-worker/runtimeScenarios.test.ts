import { describe, expect, it } from 'vitest';
import { FakeStore } from '@lib/storage/fakeStore';
import { DraftStore } from '@lib/content/DraftStore';
import { publishApprovedDrafts } from './contentHandlers.publish';
import { RunCoordinator } from '@lib/autopilot/RunCoordinator';
import { RunReportStore } from '@lib/autopilot/RunReportStore';
import { EffectAccountant } from '@lib/autopilot/EffectAccountant';
import { EffectService } from '@lib/autopilot/EffectService';
import { registerRunRecoveryLifecycle } from './runLifecycle';
import { ContentRunSession } from '../content/runSession';
import { registerScopedContentActionRuntime } from '../content/scopedActionRuntime';
import { runWithEngagementOwner } from '../content/engagementOwner';
import { readOwnerName } from '../content/readOwner';
import type { Clock } from '@lib/ports';
import type { Draft } from '@lib/types';

const clock: Clock = { now: () => new Date('2026-10-05T10:00:00.000Z') };

function draft(id: string, approved = false): Draft {
  return {
    id,
    ideaTopic: 'topic',
    ideaAngle: 'angle',
    text: `text-${id}`,
    createdAt: '2026-10-01T00:00:00.000Z',
    approved,
    mediaAttached: true,
    kind: 'post',
    accountId: 'acct-1',
  };
}

function coordinator(store: FakeStore) {
  let next = 0;
  return new RunCoordinator({
    store,
    clock,
    reports: new RunReportStore(store),
    createId: () => `id-${++next}`,
  });
}

describe('runtime scenarios', () => {
  it('keeps both approvals when two writes race on the same draft list', async () => {
    const store = new FakeStore();
    const drafts = new DraftStore(store);
    await drafts.add(draft('a'));
    await drafts.add(draft('b'));
    await Promise.all([drafts.setApproved('a', true), drafts.setApproved('b', true)]);
    const saved = await drafts.all();
    expect(saved.find((item) => item.id === 'a')?.approved).toBe(true);
    expect(saved.find((item) => item.id === 'b')?.approved).toBe(true);
  });

  it('does not publish a draft whose approval is revoked before the effect is committed', async () => {
    const store = new FakeStore();
    const drafts = new DraftStore(store);
    await store.set('linkedin:account', {
      id: 'acct-1',
      publicId: 'ada',
      capturedAt: '2026-10-01T00:00:00.000Z',
    });
    await drafts.add(draft('post-1', true));
    await store.set('modules:state', [
      { id: 'content', enabled: true, available: true, automationLevel: 'manual', dailyLimit: 1 },
    ]);
    let published = 0;
    const result = await publishApprovedDrafts({
      store,
      clock,
      prepare: async () => {
        await drafts.setApproved('post-1', false);
      },
      publish: async () => {
        published += 1;
        return { ok: true };
      },
    });
    expect(result).toMatchObject({ published: 0, reason: 'no_approved_draft' });
    expect(published).toBe(0);
  });

  it('restarts the worker onto the same store and finalizes a stopping run once', async () => {
    const store = new FakeStore();
    const first = coordinator(store);
    const begun = await first.begin({
      requestId: 'start-1',
      host: 'tab',
      day: '2026-10-05',
      ceiling: 10,
      used: 2,
    });
    if (begun.kind !== 'started') throw new Error(begun.kind);
    await first.requestStop(begun.runId, 'interrupted');
    const usedBefore = (await store.get<{ used: number }>('autopilot:state'))?.used;

    const restarted = coordinator(store);
    const effects = new EffectService({
      coordinator: restarted,
      accountant: new EffectAccountant(store),
      clock,
      sleep: async () => undefined,
      timeoutMs: 5,
      pollMs: 1,
    });
    let startups = 0;
    const onStartup = {
      addListener(listener: () => void) {
        startups += 1;
        listener();
      },
    };
    registerRunRecoveryLifecycle(
      {
        runtime: { onInstalled: { addListener() {} }, onStartup },
        tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
        windows: { onRemoved: { addListener() {} } },
      },
      {
        recover: async () => {
          await effects.recover();
        },
        tabRemoved: () => undefined,
        tabUpdated: () => undefined,
        windowRemoved: () => undefined,
      },
    );
    await effects.recover();
    const reports = await new RunReportStore(store).list();
    expect(startups).toBe(1);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.id).toBe(begun.runId);
    expect((await store.get<{ used: number }>('autopilot:state'))?.used).toBe(usedBefore);
    await effects.recover();
    expect(await new RunReportStore(store).list()).toHaveLength(1);
  });

  it('does not confirm an action when STOP arrives while it is still running', async () => {
    const store = new FakeStore();
    const run = coordinator(store);
    const begun = await run.begin({
      requestId: 'start-2',
      host: 'tab',
      day: '2026-10-05',
      ceiling: 10,
      used: 0,
    });
    if (begun.kind !== 'started') throw new Error(begun.kind);
    const reserved = await run.reserveEffect(begun.runId, 'like-1', {
      kind: 'like',
      targetKey: 'urn:li:activity:1',
      postUrn: 'urn:li:activity:1',
    });
    if (reserved.kind !== 'reserved') throw new Error(reserved.kind);
    await run.commitEffect(begun.runId, reserved.effectId, 'like-1', 'attempt-1');

    const session = new ContentRunSession();
    session.begin(begun.runId);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let listener: (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => boolean = () => false;
    registerScopedContentActionRuntime(
      {
        addListener: (next) => {
          listener = next;
        },
      },
      {
        session,
        currentUrl: () => 'https://www.linkedin.com/feed/',
        acceptIncoming: async () => ({ accepted: 0 }),
        dwell: async () => ({ ok: true }),
        sleep: async () => undefined,
        executeAction: async (_action, shouldAbort) => {
          await gate;
          return shouldAbort() ? { ok: false, reason: 'cancelled' } : { ok: true };
        },
      },
    );
    const response = new Promise<unknown>((resolve) => {
      listener(
        {
          type: 'EXECUTE_ACTION',
          runId: begun.runId,
          effect: {
            runId: begun.runId,
            effectId: reserved.effectId,
            requestId: 'like-1',
            descriptor: reserved.lease.descriptor,
          },
          action: {
            type: 'connect',
            target: {
              url: 'https://www.linkedin.com/in/ada/',
              meta: { memberId: '1', name: 'Ada' },
            },
          },
        },
        {},
        resolve,
      );
    });
    session.stop(begun.runId);
    await run.requestStop(begun.runId, 'manual');
    release();
    await expect(response).resolves.toMatchObject({ ok: false, reason: 'cancelled' });
    const settled = await run.settleEffect(begun.runId, reserved.effectId, 'like-1', 'cancelled', {
      attemptId: 'attempt-1',
    });
    expect(settled.kind === 'settled' && settled.receipt.outcome).toBe('cancelled');
  });

  it('stops with unsupported_dom when the feed identity disappears mid-action and does not confirm', async () => {
    document.body.innerHTML = `
      <div id="shareboxProfilePictureComponentRef">
        <a href="/in/ada/"><img alt="Ada Lovelace"></a>
      </div>
    `;
    const store = new FakeStore();
    const run = coordinator(store);
    const begun = await run.begin({
      requestId: 'start-3',
      host: 'tab',
      day: '2026-10-05',
      ceiling: 10,
      used: 0,
    });
    if (begun.kind !== 'started') throw new Error(begun.kind);
    const reasons: string[] = [];
    let confirmed = false;
    await runWithEngagementOwner(
      document,
      {
        required: true,
        shouldAbort: () => false,
        waitOptions: { attempts: 1, intervalMs: 0, wait: async () => undefined },
      },
      async () => {
        document.body.innerHTML = '<main></main>';
        if (!readOwnerName(document)) {
          reasons.push('unsupported_dom');
          await run.requestStop(begun.runId, 'unsupported_dom');
          return;
        }
        confirmed = true;
      },
    );
    expect(confirmed).toBe(false);
    expect(reasons).toContain('unsupported_dom');
    const state = await run.getState();
    expect(state?.stopReason).toBe('unsupported_dom');
    expect(
      state?.effectLedger && 'receipts' in (state.effectLedger as object)
        ? Object.values(
            (state.effectLedger as { receipts: Record<string, { outcome: string }> }).receipts,
          )
        : [],
    ).toEqual([]);
  });
});
