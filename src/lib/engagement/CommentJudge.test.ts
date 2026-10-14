import { describe, it, expect } from 'vitest';
import { CommentJudge } from './CommentJudge';
import type { Guardrails } from '@lib/types';

const guardrails: Guardrails = {
  minConfidence: 0.6,
  bannedPhrases: ['great post', 'thanks for sharing'],
  quarantineMinutes: 10,
  lenRange: [12, 280],
};

describe('CommentJudge', () => {
  const judge = new CommentJudge();
  const good = 'Solid take — we hit the same SSR hydration issue on Vue.';

  it('passes a valid comment with sufficient confidence', () => {
    const v = judge.judge(good, guardrails, 0.8);
    expect(v.ok).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it('blocks a comment shorter than the range', () => {
    const v = judge.judge('nice', guardrails, 0.9);
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain('too_short');
  });

  it('blocks a comment longer than the range', () => {
    const v = judge.judge('x'.repeat(281), guardrails, 0.9);
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain('too_long');
  });

  it('blocks a banned phrase regardless of case', () => {
    const v = judge.judge('Great Post, really insightful stuff here', guardrails, 0.9);
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain('banned_phrase');
  });

  it('blocks when confidence is below the minimum', () => {
    const v = judge.judge(good, guardrails, 0.4);
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain('low_confidence');
  });

  it('skips the confidence gate when no confidence is supplied', () => {
    const v = judge.judge(good, guardrails);
    expect(v.ok).toBe(true);
  });

  it('reports every violation at once', () => {
    const v = judge.judge('thanks for sharing', guardrails, 0.1);
    expect(v.ok).toBe(false);
    expect(v.reasons).toEqual(expect.arrayContaining(['banned_phrase', 'low_confidence']));
  });
});
