import { describe, it, expect } from 'vitest';
import type { EffectDescriptor, EffectOutcome, EffectReceipt } from '../types';
import {
  buildReportModules,
  withEffectLedgerOutcomes,
  withEngagementRunDelta,
} from './runOutcomes';

function receipt(
  effectId: string,
  descriptor: EffectDescriptor,
  outcome: EffectOutcome,
): EffectReceipt {
  return {
    effectId,
    requestId: `request-${effectId}`,
    descriptor,
    reservedAt: '2026-08-11T10:00:00.000Z',
    committedAt: '2026-08-11T10:00:01.000Z',
    settledAt: '2026-08-11T10:00:02.000Z',
    outcome,
    accounting: 'applied',
  };
}

describe('buildReportModules', () => {
  it('emits a row per touched module, in run order, carrying executed + reason', () => {
    const rows = buildReportModules({
      profile_views: { executed: 2, reason: 'done' },
      smart_connect: { executed: 0, reason: 'empty_search' },
      content: { executed: 0, reason: 'not_publish_day' },
      engagement: { executed: 5, reason: 'done' },
    });
    expect(rows).toEqual([
      { id: 'engagement', executed: 5, skipped: 0, failed: 0, reason: 'done' },
      {
        id: 'smart_connect',
        executed: 0,
        skipped: 0,
        failed: 0,
        reason: 'empty_search',
      },
      {
        id: 'content',
        executed: 0,
        skipped: 0,
        failed: 0,
        reason: 'not_publish_day',
      },
      {
        id: 'profile_views',
        executed: 2,
        skipped: 0,
        failed: 0,
        reason: 'done',
      },
    ]);
  });

  it('omits modules with no recorded outcome', () => {
    const rows = buildReportModules({
      smart_connect: { executed: 1, reason: 'done' },
    });
    expect(rows).toEqual([
      {
        id: 'smart_connect',
        executed: 1,
        skipped: 0,
        failed: 0,
        reason: 'done',
      },
    ]);
  });

  it('keeps a zero-executed disabled module visible (the whole point)', () => {
    const rows = buildReportModules({
      engagement: { executed: 0, reason: 'disabled' },
    });
    expect(rows).toEqual([
      {
        id: 'engagement',
        executed: 0,
        skipped: 0,
        failed: 0,
        reason: 'disabled',
      },
    ]);
  });

  it('returns [] when nothing ran', () => {
    expect(buildReportModules({})).toEqual([]);
  });

  it('preserves explicit skipped and failed evidence instead of replacing it with fake zeros', () => {
    const rows = buildReportModules({
      profile_views: { executed: 2, skipped: 3, failed: 1, reason: 'partial' },
    });

    expect(rows).toEqual([
      {
        id: 'profile_views',
        executed: 2,
        skipped: 3,
        failed: 1,
        reason: 'partial',
      },
    ]);
  });

  it('reconciles engagement executed from the non-negative run delta while keeping reason', () => {
    expect(
      withEngagementRunDelta({ engagement: { executed: 99, reason: 'feed_exhausted' } }, 12, 7),
    ).toEqual({ engagement: { executed: 5, reason: 'feed_exhausted' } });

    expect(withEngagementRunDelta({ engagement: { executed: 4, reason: 'done' } }, 2, 7)).toEqual({
      engagement: { executed: 0, reason: 'done' },
    });
  });

  it('does not invent an engagement outcome for an untouched module', () => {
    expect(
      withEngagementRunDelta({ smart_connect: { executed: 1, reason: 'done' } }, 9, 7),
    ).toEqual({
      smart_connect: { executed: 1, reason: 'done' },
    });
  });

  it('uses confirmed receipts as execution SSOT and uncertain/failed as failures', () => {
    const person = {
      memberId: 'm1',
      name: 'Ada',
      headline: 'CTO',
      profileUrl: '/in/ada',
    };
    const effects = [
      receipt('like-ok', { kind: 'like', targetKey: 'p1' }, 'confirmed'),
      receipt('like-uncertain', { kind: 'like', targetKey: 'p2' }, 'uncertain'),
      receipt('comment-ok', { kind: 'comment', targetKey: 'p3' }, 'confirmed'),
      receipt('comment-failed', { kind: 'comment', targetKey: 'p4' }, 'failed'),
      receipt('connect-ok', { kind: 'connect', targetKey: 'm1', person }, 'confirmed'),
      receipt(
        'publish-ok',
        { kind: 'publish', targetKey: 'draft-1', draftId: 'draft-1' },
        'confirmed',
      ),
      receipt('view-ok', { kind: 'profile_view', targetKey: 'm1', person }, 'confirmed'),
      receipt('ignored-already', { kind: 'like', targetKey: 'p5' }, 'already'),
      receipt(
        'ignored-cancelled',
        { kind: 'publish', targetKey: 'draft-2', draftId: 'draft-2' },
        'cancelled',
      ),
    ];

    expect(
      withEffectLedgerOutcomes(
        {
          engagement: {
            executed: 99,
            skipped: 3,
            failed: 99,
            reason: 'feed_exhausted',
          },
          smart_connect: {
            executed: 99,
            skipped: 2,
            failed: 99,
            reason: 'done',
          },
        },
        effects,
      ),
    ).toEqual({
      engagement: {
        executed: 1,
        skipped: 3,
        failed: 2,
        reason: 'feed_exhausted',
      },
      smart_connect: { executed: 1, skipped: 2, failed: 0, reason: 'done' },
      content: { executed: 1, skipped: 0, failed: 0, reason: 'done' },
      profile_views: { executed: 1, skipped: 0, failed: 0, reason: 'done' },
    });
  });

  it('counts only confirmed likes as engagement execution and includes comment failures', () => {
    const effects = [
      receipt('like-ok', { kind: 'like', targetKey: 'p1' }, 'confirmed'),
      receipt('comment-ok', { kind: 'comment', targetKey: 'p2' }, 'confirmed'),
      receipt('comment-failed', { kind: 'comment', targetKey: 'p3' }, 'failed'),
      receipt('comment-uncertain', { kind: 'comment', targetKey: 'p4' }, 'uncertain'),
    ];

    expect(withEffectLedgerOutcomes({}, effects).engagement).toEqual({
      executed: 1,
      skipped: 0,
      failed: 2,
      reason: 'done',
    });
  });
});
