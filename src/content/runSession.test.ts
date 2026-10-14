import { describe, expect, it } from 'vitest';
import { ContentRunSession } from './runSession';

describe('ContentRunSession', () => {
  it('reserves a run before pre-loop work and transitions that same run to the loop once', () => {
    const session = new ContentRunSession();

    expect(session.attach('run-1')).toBe('attached');
    expect(session.attach('run-1')).toBe('duplicate');
    expect(session.isActive('run-1')).toBe(true);
    expect(session.isLooping('run-1')).toBe(false);
    expect(session.beginLoop('run-1')).toBe('started');
    expect(session.beginLoop('run-1')).toBe('duplicate');
    expect(session.isLooping('run-1')).toBe(true);
  });

  it('rejects a loop that was never attached and lets scoped STOP cancel a reserved run', () => {
    const session = new ContentRunSession();

    expect(session.beginLoop('run-1')).toBe('missing');
    expect(session.attach('run-1')).toBe('attached');
    expect(session.stop('run-1')).toBe(true);
    expect(session.isActive('run-1')).toBe(false);
    expect(session.beginLoop('run-1')).toBe('duplicate');
  });

  it('starts once and treats a repeated RUN_LOOP for the same id as idempotent', () => {
    const session = new ContentRunSession();

    expect(session.begin('run-1')).toBe('started');
    expect(session.begin('run-1')).toBe('duplicate');
    expect(session.activeRunId).toBe('run-1');
  });

  it('rejects a different run while one is active', () => {
    const session = new ContentRunSession();
    session.begin('run-1');

    expect(session.begin('run-2')).toBe('busy');
    expect(session.activeRunId).toBe('run-1');
  });

  it('does not restart the same run after it already finished', () => {
    const session = new ContentRunSession();
    session.begin('run-1');
    session.finish('run-1');

    expect(session.begin('run-1')).toBe('duplicate');
    expect(session.activeRunId).toBeNull();
    expect(session.begin('run-2')).toBe('started');
  });

  it('ignores mismatched stop and accepts scoped or legacy stop', () => {
    const session = new ContentRunSession();
    session.begin('run-1');

    expect(session.stop('old-run')).toBe(false);
    expect(session.isActive('run-1')).toBe(true);
    expect(session.stop('run-1')).toBe(true);
    expect(session.activeRunId).toBeNull();

    session.begin('run-2');
    expect(session.stop()).toBe(true);
  });
});
