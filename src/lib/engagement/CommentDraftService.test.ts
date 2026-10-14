import { describe, it, expect } from 'vitest';
import { CommentDraftService, clampComment } from './CommentDraftService';
import type { LlmProvider, LlmRequest } from '@lib/llm/contracts';
import type { CommentDraftInput } from './CommentDraftService';

function fakeProvider(reply: string) {
  const calls: LlmRequest[] = [];
  const provider: LlmProvider = {
    id: 'openrouter',
    async complete(req) {
      calls.push(req);
      return { text: reply, model: 'fake', provider: 'openrouter' };
    },
    async listModels() {
      return { models: [], source: 'live', keyStatus: 'valid' } as const;
    },
  };
  return { provider, calls };
}

const input: CommentDraftInput = {
  post: {
    urn: 'urn:li:activity:9',
    authorName: 'Anna',
    authorHeadline: 'Recruiter',
    text: 'How do you handle SSR hydration mismatches?',
  },
  expertise: { headline: 'Frontend TechLead', stack: ['Vue', 'TypeScript'], bio: '11y' },
  tone: 'expert',
  language: 'English',
};

describe('CommentDraftService', () => {
  it('returns the provider completion, trimmed', async () => {
    const { provider } = fakeProvider('  In our Vue SSR work we gate hydration on idle.  ');
    const out = await new CommentDraftService(provider).draft(input);
    expect(out).toBe('In our Vue SSR work we gate hydration on idle.');
  });

  it('clamps an over-long multi-sentence reply to the first 2 sentences', async () => {
    const { provider } = fakeProvider(
      'Great point about hydration. How do you measure the mismatch rate in production? ' +
        'We saw it spike on slow networks. Also, do you preload the critical CSS?',
    );
    const out = await new CommentDraftService(provider).draft(input);
    expect(out).toBe(
      'Great point about hydration. How do you measure the mismatch rate in production?',
    );
  });

  it('allows a short opinion OR a question — not forced into a question', async () => {
    const { provider, calls } = fakeProvider('ok');
    await new CommentDraftService(provider).draft(input);
    const sys = (calls[0].messages.find((m) => m.role === 'system')?.content ?? '').toLowerCase();
    expect(sys).toContain('opinion'); // a brief take is allowed…
    expect(sys).toContain('question'); // …or a clarifying question — whichever fits
    expect(sys).not.toContain('must ask'); // no longer hard-forced into a question
  });

  it('feeds the post text, the user voice and the tone to the model', async () => {
    const { provider, calls } = fakeProvider('ok');
    await new CommentDraftService(provider).draft(input);
    const joined = calls[0].messages
      .map((m) => m.content)
      .join('\n')
      .toLowerCase();
    expect(joined).toContain('ssr hydration mismatches');
    expect(joined).toContain('vue'); // voice only — not a relevance gate
    expect(joined).toContain('expert');
    expect(joined).toContain('english');
  });

  it('does NOT cap maxTokens (reasoning models spend budget before the content)', async () => {
    const { provider, calls } = fakeProvider('ok');
    await new CommentDraftService(provider).draft(input);
    expect(calls[0].maxTokens).toBeUndefined();
  });

  it('sends a system instruction (anti-slop framing) plus the user prompt', async () => {
    const { provider, calls } = fakeProvider('ok');
    await new CommentDraftService(provider).draft(input);
    expect(calls[0].messages.some((m) => m.role === 'system')).toBe(true);
    expect(calls[0].messages.some((m) => m.role === 'user')).toBe(true);
  });
});

describe('clampComment', () => {
  it('keeps a 1–2 sentence comment unchanged', () => {
    expect(clampComment('What metric did you use?')).toBe('What metric did you use?');
    expect(clampComment('Nice. What metric did you use?')).toBe('Nice. What metric did you use?');
  });

  it('trims to the first 2 sentences (preserving the question mark)', () => {
    expect(clampComment('A. B? C! D.')).toBe('A. B?');
  });

  it('hard-caps a single runaway sentence at a word boundary with an ellipsis', () => {
    const long = 'word '.repeat(80).trim() + ' end'; // ~404 chars, no sentence break
    const out = clampComment(long);
    expect(out.length).toBeLessThanOrEqual(281);
    expect(out.endsWith('…')).toBe(true);
  });

  it('handles text with no sentence punctuation', () => {
    expect(clampComment('just a short phrase')).toBe('just a short phrase');
  });
});
