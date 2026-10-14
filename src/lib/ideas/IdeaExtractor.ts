import type { LlmProvider } from '../llm/contracts';
import type { ExpertiseProfile, FeedItem, Idea, IdeaSpark } from '../types';

/**
 * Turns harvested feed posts into a bank of content ideas.
 *
 * The critical anti-slop rule: the feed is a SIGNAL of what topics resonate, not
 * a set of examples to imitate. Echoing posts produces generic AI-slop that kills
 * the "brand" pillar. So the prompt forbids copying and asks for the BROADER, more
 * human angle each topic opens up (career, lessons, opinions) — a light tech undertone,
 * not a deep-dive — so the post earns reach + views. Behind LlmProvider → fake-tested.
 */
export class IdeaExtractor {
  constructor(private readonly provider: LlmProvider) {}

  async extract(posts: FeedItem[], expertise: ExpertiseProfile): Promise<Idea[]> {
    const system = [
      'You surface CONTENT IDEAS for the user to post on LinkedIn.',
      `The user works in: ${expertise.headline}. Stack: ${expertise.stack.join(', ')} — but that is a light undertone, not the whole post.`,
      'The feed posts below are a SIGNAL of which topics resonate now — NOT examples to imitate.',
      'Do not copy, summarise or paraphrase the posts. Echoing the feed is AI-slop and is forbidden.',
      'Find the BROADER, more human angle each topic opens up — a career lesson, a behind-the-scenes story, an opinion, or a relatable observation — that a WIDE audience engages with (peers AND a recruiter or non-specialist scrolling the feed), so the post earns reach and views, not only niche-engineer depth.',
      "Keep a light tech undertone, avoid dry deep-technical deep-dives, and ground each idea in the user's real experience.",
      'Ground EACH idea in ONE specific post. Return ONLY a JSON array of',
      '[{"topic": string, "angle": string, "sourceIndex": number, "claim": string, "quote": string}].',
      'sourceIndex = the 1-based number of the post that sparked it. claim = its point/tension worth a take.',
      'quote = a short (<140 char) snippet from that post.',
      // The user reads topic/angle/claim in their own language to pick what to post — the
      // POST itself is generated separately in its own language, so the idea language is
      // independent. quote is evidence from the (English) source, so keep it untranslated.
      'Write "topic", "angle" and "claim" in RUSSIAN. Keep "quote" VERBATIM from the source post — do NOT translate it.',
      'CRITICAL: your ENTIRE reply must be the raw JSON array — it MUST start with "[" and end',
      'with "]". No prose, no explanation, no markdown, no code fences before or after.',
    ].join(' ');

    const user = [
      'Feed posts (signal only):',
      ...posts.map((p, i) => `${i + 1}. ${p.excerpt}`),
      'Reply with ONLY the JSON array of 3–6 ideas. Start your reply with "[".',
    ].join('\n');

    const completion = await this.provider.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // No maxTokens cap: reasoning models (e.g. gemini-3.5-flash) spend a reasoning
      // phase BEFORE the content, so a small cap starves the output → empty/truncated
      // content → parse fails → 0 ideas. The "3–6 ideas" instruction bounds output;
      // matches DraftGenerator/CommentDraftService, which also omit the cap.
      // Higher temperature → more varied, broader-audience angles (not literal tech extraction).
      temperature: 0.7,
    });
    return parseIdeas(completion.text, posts);
  }
}

interface RawIdea {
  topic: unknown;
  angle: unknown;
  sourceIndex?: unknown;
  claim?: unknown;
  quote?: unknown;
}

/** Tolerantly parse ideas, grounding each in its source post (spark). Handles ``` fences. */
export function parseIdeas(raw: string, posts: FeedItem[]): Idea[] {
  const json = extractJsonArray(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('ideas_not_json');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('ideas_not_json');
  }
  return parsed
    .filter(
      (e): e is RawIdea =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as RawIdea).topic === 'string' &&
        ((e as RawIdea).topic as string).length > 0 &&
        typeof (e as RawIdea).angle === 'string' &&
        ((e as RawIdea).angle as string).length > 0,
    )
    .map((e) => {
      const idea: Idea = { topic: e.topic as string, angle: e.angle as string };
      if (typeof e.claim === 'string' && e.claim.length > 0) {
        const quote = typeof e.quote === 'string' ? e.quote : '';
        const i = typeof e.sourceIndex === 'number' ? e.sourceIndex - 1 : -1;
        const spark: IdeaSpark =
          i >= 0 && i < posts.length
            ? { claim: e.claim, quote, source: { author: posts[i].author, id: posts[i].id } }
            : { claim: e.claim, quote };
        idea.spark = spark;
      }
      return idea;
    });
}

function extractJsonArray(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('ideas_not_json');
  }
  return body.slice(start, end + 1);
}
