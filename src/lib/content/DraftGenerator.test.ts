import { describe, it, expect } from 'vitest';
import { DraftGenerator } from './DraftGenerator';
import type { LlmProvider, LlmRequest, LlmCompletion } from '@lib/llm/contracts';
import type { Idea, ExpertiseProfile } from '@lib/types';

class FakeProvider implements LlmProvider {
  readonly id = 'openrouter' as const;
  last?: LlmRequest;
  constructor(private readonly text: string) {}
  async complete(req: LlmRequest): Promise<LlmCompletion> {
    this.last = req;
    return { text: this.text, model: 'm', provider: this.id };
  }
  async listModels() {
    return { models: [], source: 'live' as const, keyStatus: 'valid' as const };
  }
}

const idea: Idea = { topic: 'tRPC vs REST', angle: 'type-safety from a Vue codebase' };
const expertise: ExpertiseProfile = {
  headline: 'Frontend TechLead, 11y Vue/TS',
  stack: ['Vue', 'TS'],
};

describe('DraftGenerator', () => {
  it('returns the trimmed post text', async () => {
    const gen = new DraftGenerator(new FakeProvider('  Here is the post.  \n'));
    expect(await gen.generate(idea, expertise, 'Write like an expert.', 'English')).toBe(
      'Here is the post.',
    );
  });

  it('feeds the idea, expertise and custom prompt into the request', async () => {
    const provider = new FakeProvider('x');
    await new DraftGenerator(provider).generate(idea, expertise, 'MY_CUSTOM_PROMPT', 'English');
    const joined = provider.last!.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('tRPC vs REST');
    expect(joined).toContain('type-safety from a Vue codebase');
    expect(joined).toContain('Frontend TechLead');
    expect(joined).toContain('MY_CUSTOM_PROMPT');
    expect(joined).toContain('English');
  });

  it('includes the user voice samples when they exist', async () => {
    const provider = new FakeProvider('x');
    await new DraftGenerator(provider).generate(idea, expertise, 'be punchy', 'English', [
      'I shipped the rewrite.',
    ]);
    expect(provider.last!.messages.map((m) => m.content).join('\n')).toContain(
      'I shipped the rewrite.',
    );
  });

  it('does not starve reasoning models with a tiny output cap (was 800 → post truncated mid-sentence)', async () => {
    // Same failure family as the ideas bug: a reasoning model (gemini-3.5-flash) spends the
    // output budget on a reasoning phase BEFORE the post text, so an 800-token cap leaves only
    // a sentence or two → the post comes back cut off mid-word. Omit the cap (or keep ≥2000).
    const provider = new FakeProvider('x');
    await new DraftGenerator(provider).generate(idea, expertise, 'be punchy', 'English');
    const cap = provider.last!.maxTokens;
    expect(cap === undefined || cap >= 2000).toBe(true);
  });
});

describe('DraftGenerator spark grounding', () => {
  it('feeds the spark claim/quote into the prompt when present', async () => {
    const provider = new FakeProvider('x');
    const sparked: Idea = {
      topic: 'T',
      angle: 'A',
      spark: {
        claim: 'Speed over purity',
        quote: 'ship fast',
        source: { author: 'Anna', id: 'urn:a' },
      },
    };
    await new DraftGenerator(provider).generate(sparked, expertise, 'be punchy', 'English');
    const joined = provider.last!.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('Speed over purity');
    expect(joined).toContain('ship fast');
    expect(joined).toMatch(/do NOT paraphrase|do not echo/i);
  });

  it('omits spark wording when the idea has no spark', async () => {
    const provider = new FakeProvider('x');
    await new DraftGenerator(provider).generate(idea, expertise, 'be punchy', 'English'); // existing `idea` has no spark
    expect(provider.last!.messages.map((m) => m.content).join('\n')).not.toMatch(/sparked by/i);
  });
});
