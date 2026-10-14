import type { LlmProvider } from '../llm/contracts';
import type { CommentTone, ExpertiseProfile, FeedPost } from '../types';

/**
 * Bound a generated comment to a short, LinkedIn-appropriate length: at most `maxSentences`
 * sentences, with a hard char backstop. Models routinely overshoot "1-2 sentences" prompts,
 * so this is the DETERMINISTIC guarantee (the prompt asks, this enforces). Sentence-boundary
 * aware so it never cuts a question mid-word; trims to a word boundary + ellipsis only if a
 * single runaway sentence still exceeds the char cap.
 */
export function clampComment(text: string, maxSentences = 2, maxChars = 280): string {
  const trimmed = text.trim();
  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [trimmed];
  let out = sentences.slice(0, maxSentences).join('').trim();
  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(' ');
    out = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + '…';
  }
  return out;
}

export interface CommentDraftInput {
  post: FeedPost;
  expertise: ExpertiseProfile;
  tone: CommentTone;
  /** Language for the generated comment (defaults handled by the caller). */
  language: string;
}

const TONE_HINT: Record<CommentTone, string> = {
  expert: 'an expert, opinionated take that adds a concrete insight',
  friendly: 'a warm, encouraging note that still says something specific',
  question: 'a sharp, genuine question that moves the discussion forward',
};

/**
 * Drafts a LinkedIn comment for a feed post via the LLM port.
 * Anti-slop framing: the model must NOT restate/summarise the post or
 * use generic praise — it adds a specific point from the user's own expertise.
 * Pure w.r.t. an injected LlmProvider, so it's tested on a fake (no network).
 */
export class CommentDraftService {
  constructor(private readonly provider: LlmProvider) {}

  async draft(input: CommentDraftInput): Promise<string> {
    const { post, expertise, tone, language } = input;
    // SSI grows through feed ACTIVITY, so the comment engages the post's OWN topic — a brief
    // opinion OR a clarifying question, whichever fits (not forced to a question, not a niche
    // take filtered to the user's stack). Expertise is voice only, never a relevance gate.
    const system = [
      'You write LinkedIn comments in the first person as the user.',
      `The user is: ${expertise.headline}. Stack: ${expertise.stack.join(', ')}.`,
      expertise.bio ? `Background: ${expertise.bio}.` : '',
      `Write the comment in ${language}.`,
      'Write ONE short, specific reaction to THIS post — either a brief opinion/take OR a',
      'clarifying question, whichever genuinely fits. It must show you actually read the post and',
      'add something concrete (engagement grows SSI).',
      'Do NOT restate or summarise the post. No generic praise ("great post").',
      'HARD LIMIT: at most 2 short sentences, under 200 characters. No preamble, no sign-off, no hashtags.',
      `Voice/tone: ${TONE_HINT[tone]}.`,
    ]
      .filter(Boolean)
      .join(' ');

    const user = [
      `Post by ${post.authorName}${post.authorHeadline ? ` (${post.authorHeadline})` : ''}:`,
      post.text,
      `Write the ${tone} comment now. Reply with the comment text only.`,
    ].join('\n');

    // No maxTokens cap: reasoning models (e.g. gemini-3.x) spend a reasoning phase BEFORE the
    // content, so a small cap starves the output → empty/truncated → judge rejects → 0 comments.
    // Bound length via the prompt + a deterministic clamp (models overshoot the prompt). Same
    // no-maxTokens family fix as Idea/Draft.
    const completion = await this.provider.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.7,
    });
    return clampComment(completion.text.trim());
  }
}
