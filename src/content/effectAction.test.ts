import { describe, expect, it } from 'vitest';
import type { ActionRequest, EffectExecutionToken } from '@lib/types';
import { effectActionResponse, effectMatchesAction } from './effectAction';

const connect: EffectExecutionToken = {
  runId: 'run-1',
  requestId: 'request-1',
  effectId: 'effect-1',
  descriptor: {
    kind: 'connect',
    targetKey: 'member-1',
    person: {
      memberId: 'member-1',
      name: 'One',
      headline: 'Engineer',
      profileUrl: 'https://www.linkedin.com/in/one/',
    },
  },
};

describe('effectMatchesAction', () => {
  it('requires connect member and profile identity to match the reservation', () => {
    const action: ActionRequest = {
      type: 'connect',
      target: {
        url: connect.descriptor.kind === 'connect' ? connect.descriptor.person.profileUrl : '',
        meta: { memberId: 'member-1', name: 'One' },
      },
    };
    expect(effectMatchesAction(connect, action)).toBe(true);
    expect(
      effectMatchesAction(connect, {
        ...action,
        target: { ...action.target, meta: { memberId: 'other' } },
      }),
    ).toBe(false);
    expect(
      effectMatchesAction(connect, {
        ...action,
        target: { ...action.target, url: 'https://www.linkedin.com/in/other/' },
      }),
    ).toBe(false);
    expect(
      effectMatchesAction(
        {
          ...connect,
          descriptor: { ...connect.descriptor, targetKey: 'other-member' },
        },
        action,
      ),
    ).toBe(false);
  });

  it('requires publish draft identity to match the action metadata', () => {
    const token: EffectExecutionToken = {
      runId: 'run-1',
      requestId: 'request-2',
      effectId: 'effect-2',
      descriptor: { kind: 'publish', targetKey: 'draft-1', draftId: 'draft-1' },
    };
    const action: ActionRequest = {
      type: 'post',
      target: { url: 'https://www.linkedin.com/feed/', meta: { draftId: 'draft-1' } },
      payload: { post: 'text' },
    };
    expect(effectMatchesAction(token, action)).toBe(true);
    expect(
      effectMatchesAction(token, {
        ...action,
        target: { ...action.target, meta: { draftId: 'draft-2' } },
      }),
    ).toBe(false);
  });
});

describe('effectActionResponse', () => {
  it('fails closed after a committed effect until settlement is acknowledged', () => {
    expect(
      effectActionResponse({
        outcome: 'confirmed',
        reserved: true,
        committed: true,
        settled: false,
      }),
    ).toEqual({
      ok: false,
      outcome: 'confirmed',
      reason: 'effect_unsettled',
      safetySpent: true,
    });
  });

  it('counts an acknowledged uncertain edge for safety without reporting it executed', () => {
    expect(
      effectActionResponse({
        outcome: 'uncertain',
        reason: 'confirmation_timeout',
        reserved: true,
        committed: true,
        settled: true,
      }),
    ).toEqual({
      ok: false,
      outcome: 'uncertain',
      reason: 'confirmation_timeout',
      safetySpent: true,
    });
  });

  it('requires recovery when commit acknowledgement was lost after reservation', () => {
    expect(
      effectActionResponse({
        outcome: 'failed',
        reason: 'commit_rejected',
        reserved: true,
        committed: false,
        settled: false,
      }),
    ).toEqual({
      ok: false,
      outcome: 'failed',
      reason: 'effect_unsettled',
      safetySpent: true,
    });
  });
});
