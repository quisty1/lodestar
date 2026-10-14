import type { LlmProvider } from '../llm/contracts';
import type { ExpertiseProfile, Idea } from '../types';

/**
 * Turns an idea + the user's custom prompt into a full LinkedIn post draft.
 * Anti-slop: the idea is the user's ORIGINAL angle, the
 * custom prompt carries voice/structure, the expertise grounds it in their
 * experience. Behind LlmProvider → fake-tested.
 */
export class DraftGenerator {
  constructor(private readonly provider: LlmProvider) {}

  async generate(
    idea: Idea,
    expertise: ExpertiseProfile,
    postPrompt: string,
    language: string,
    voiceSamples: string[] = [],
  ): Promise<string> {
    const system = [
      "You write LinkedIn posts in the user's own voice.",
      `The user is: ${expertise.headline}. Stack: ${expertise.stack.join(', ')}.`,
      expertise.bio ? `Background: ${expertise.bio}.` : '',
      voiceSamples.length
        ? `Match the voice of these past posts by the user, without copying them:\n${voiceSamples.map((sample) => `- ${sample}`).join('\n')}`
        : '',
      'Write ONE post. Output only the post text — no preamble, no markdown headers, no quotes.',
      `Write the post in ${language}.`,
      "Never sound like generic AI thought-leadership; be specific and grounded in the user's experience.",
    ]
      .filter(Boolean)
      .join(' ');

    const user = [
      `Topic: ${idea.topic}`,
      `My angle: ${idea.angle}`,
      ...(idea.spark
        ? [
            'This idea was sparked by a real post resonating now:',
            `- Their point: ${idea.spark.claim}`,
            ...(idea.spark.quote ? [`- They wrote: "${idea.spark.quote}"`] : []),
            'Respond to / extend that point from YOUR experience. Do NOT paraphrase or echo their wording.',
          ]
        : []),
      '',
      'Author the post following these instructions:',
      postPrompt,
    ].join('\n');

    const completion = await this.provider.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // No maxTokens cap: reasoning models (e.g. gemini-3.5-flash) spend the output
      // budget on reasoning BEFORE the post, so a cap (was 800) truncates the post
      // mid-sentence. Matches IdeaExtractor. A LinkedIn post is self-limiting via the prompt.
      temperature: 0.8,
    });
    return completion.text.trim();
  }
}
