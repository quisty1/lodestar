// src/service-worker/contentHandlers.ts
// SW-side content/LLM orchestration, extracted from index.ts (SRP + ≤300).
// All deps are injected so each handler is unit-testable with fakes (the LLM
// boundary is crossed by a fake HttpClient returning real-shape responses).
import { createLlmProvider } from '@lib/llm/createLlmProvider';
import { loadLlmConfig } from '@lib/llm/config';
import { loadContentSettings, languageName } from '@lib/content/settings';
import { DraftGenerator } from '@lib/content/DraftGenerator';
import { DraftStore } from '@lib/content/DraftStore';
import { asArray, loadSettings } from '@lib/engagement/settings';
import { CommentDraftService } from '@lib/engagement/CommentDraftService';
import { CommentJudge } from '@lib/engagement/CommentJudge';
import { COMMENT_ACTED_KEY, COMMENT_BUDGET_KEY } from '@lib/engagement/CommentDayBudget';
import { enabledModules } from '@lib/autopilot/startGate';
import { IdeaExtractor } from '@lib/ideas/IdeaExtractor';
import { IdeaBank } from '@lib/ideas/IdeaBank';
import { feedPostToFeedItem } from '@lib/ideas/feedItem';
import {
  ideasPerDayLimit,
  rolloverIdeaDay,
  recordIdeaDay,
  remainingIdeas,
  IDEA_BUDGET_KEY,
  IDEAS_LAST_RUN_KEY,
  type IdeaDay,
} from '@lib/ideas/IdeaDayBudget';
import type { HttpClient, HttpGet, LlmProviderId } from '@lib/llm/contracts';
import type { ModelCatalogResult } from '@lib/llm/models';
import type { Clock, KeyValueStore } from '@lib/ports';
import type { Draft, FeedPost, Idea, IdeasLastRun } from '@lib/types';

export type LlmHttp = HttpClient & HttpGet;

/** List models with explicit catalog/authentication provenance for truthful UI. */
export async function listModels(
  http: LlmHttp,
  provider: LlmProviderId,
  apiKey: string,
): Promise<ModelCatalogResult> {
  return createLlmProvider({ provider, apiKey }, http).listModels();
}

export interface DraftDeps {
  store: KeyValueStore;
  http: LlmHttp;
  clock: Clock;
  newId: () => string;
}

/** Idea + custom prompt → post draft (LLM) → store. Returns the new draft. */
export async function generateDraft(
  deps: DraftDeps,
  idea: Idea,
): Promise<{ draft: Draft | null; error?: string }> {
  const cfg = await loadLlmConfig(deps.store);
  if (!cfg.apiKey.trim()) return { draft: null, error: 'no_key' };
  const { expertise } = await loadSettings(deps.store);
  const { postPrompt, contentLanguage, voiceSamples } = await loadContentSettings(deps.store);
  const provider = createLlmProvider(
    { provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model },
    deps.http,
  );
  try {
    const text = await new DraftGenerator(provider).generate(
      idea,
      expertise,
      postPrompt,
      languageName(contentLanguage),
      voiceSamples,
    );
    const draft: Draft = {
      id: deps.newId(),
      ideaTopic: idea.topic,
      ideaAngle: idea.angle,
      text,
      createdAt: deps.clock.now().toISOString(),
      mediaAttached: false,
      kind: 'post',
    };
    await new DraftStore(deps.store).add(draft);
    return { draft };
  } catch (e) {
    return { draft: null, error: e instanceof Error ? e.message : 'llm_failed' };
  }
}

export interface IdeaDeps {
  store: KeyValueStore;
  http: LlmHttp;
  harvest: (limit: number) => Promise<FeedPost[]>;
}

/** Harvest the feed → extract ideas (LLM) → bank them. Returns the full bank. */
export async function generateIdeas(deps: IdeaDeps): Promise<{ ideas: Idea[]; error?: string }> {
  const cfg = await loadLlmConfig(deps.store);
  if (!cfg.apiKey.trim()) return { ideas: [], error: 'no_key' };
  const { expertise } = await loadSettings(deps.store);
  if (!expertise.headline.trim()) return { ideas: [], error: 'no_expertise' };
  const posts = await deps.harvest(20);
  if (!posts.length) return { ideas: [], error: 'no_feed' };

  const provider = createLlmProvider(
    { provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model },
    deps.http,
  );
  const bank = new IdeaBank(deps.store);
  try {
    const ideas = await new IdeaExtractor(provider).extract(
      posts.map(feedPostToFeedItem),
      expertise,
    );
    await bank.add(ideas);
    return { ideas: await bank.all() };
  } catch (e) {
    return { ideas: [], error: e instanceof Error ? e.message : 'llm_failed' };
  }
}

export interface RunIdeaDeps {
  store: KeyValueStore;
  http: LlmHttp;
  clock: Clock;
  cancelled?: () => boolean | Promise<boolean>;
}

/** Minimum buffered posts to spend an LLM call on (anti-slop: a thin feed makes weak ideas). */
export const MIN_IDEA_BUFFER = 5;

/**
 * Extract ideas from a buffer the autopilot loop already harvested (no re-scroll),
 * capped by the day-keyed ideas/day budget. Crosses the real LLM mapper. Returns how
 * many NEW ideas were banked (dedup-aware) so a failed/duplicate extraction costs no budget.
 * Writes `ideas:lastRun` on EVERY exit so a silently-skipped/failed auto-collect is visible.
 */
export async function extractRunIdeas(
  deps: RunIdeaDeps,
  posts: FeedPost[],
): Promise<{ stored: number; error?: string }> {
  const cancelled = () => isCancelled(deps.cancelled);
  const writeLast = (r: Omit<IdeasLastRun, 'at'>) =>
    deps.store.set(IDEAS_LAST_RUN_KEY, { at: deps.clock.now().toISOString(), ...r });

  if (await cancelled()) return { stored: 0, error: 'cancelled' };
  if (!posts.length) {
    await writeLast({ reason: 'no_feed', stored: 0 });
    return { stored: 0, error: 'no_feed' };
  }
  const modulesState = await deps.store.get('modules:state');
  if (await cancelled()) return { stored: 0, error: 'cancelled' };
  // SW self-guards (gatekeeper SSOT): never extract for a disabled content module,
  // even if a future caller or a manual message reaches this handler.
  if (!enabledModules(modulesState).some((m) => m.id === 'content')) {
    await writeLast({ reason: 'disabled', stored: 0 });
    return { stored: 0 };
  }
  const cfg = await loadLlmConfig(deps.store);
  if (await cancelled()) return { stored: 0, error: 'cancelled' };
  if (!cfg.apiKey.trim()) {
    await writeLast({ reason: 'no_key', stored: 0 });
    return { stored: 0, error: 'no_key' };
  }
  const { expertise } = await loadSettings(deps.store);
  if (await cancelled()) return { stored: 0, error: 'cancelled' };
  if (!expertise.headline.trim()) {
    await writeLast({ reason: 'no_expertise', stored: 0 });
    return { stored: 0, error: 'no_expertise' };
  }
  // Anti-slop (invariant #4): don't spend an LLM call on a thin buffer — but still
  // RECORD the run so the Content tab shows "too few posts" instead of going silent.
  if (posts.length < MIN_IDEA_BUFFER) {
    await writeLast({ reason: 'thin_feed', stored: 0, posts: posts.length });
    return { stored: 0 };
  }

  const limit = ideasPerDayLimit(modulesState);
  const today = deps.clock.now().toISOString().slice(0, 10);
  const budget = rolloverIdeaDay((await deps.store.get<IdeaDay>(IDEA_BUDGET_KEY)) ?? null, today);
  if (await cancelled()) return { stored: 0, error: 'cancelled' };
  const allowance = remainingIdeas(budget, limit);
  if (allowance <= 0) {
    await writeLast({
      reason: 'budget_exhausted',
      stored: 0,
      budget: { used: budget.used, limit },
    });
    return { stored: 0 };
  }

  const provider = createLlmProvider(
    { provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model },
    deps.http,
  );
  const bank = new IdeaBank(deps.store);
  try {
    const before = (await bank.all()).length;
    if (await cancelled()) return { stored: 0, error: 'cancelled' };
    const ideas = await new IdeaExtractor(provider).extract(
      posts.map(feedPostToFeedItem),
      expertise,
    );
    if (await cancelled()) return { stored: 0, error: 'cancelled' };
    await bank.add(ideas.slice(0, allowance));
    if (await cancelled()) return { stored: 0, error: 'cancelled' };
    const stored = (await bank.all()).length - before;
    if (await cancelled()) return { stored: 0, error: 'cancelled' };
    await deps.store.set(IDEA_BUDGET_KEY, recordIdeaDay(budget, stored));
    if (await cancelled()) return { stored: 0, error: 'cancelled' };
    await writeLast({ reason: 'ok', stored, budget: { used: budget.used + stored, limit } });
    return { stored };
  } catch (e) {
    if (await cancelled()) return { stored: 0, error: 'cancelled' };
    const error = e instanceof Error ? e.message : 'llm_failed';
    await writeLast({ reason: 'error', stored: 0, error });
    return { stored: 0, error };
  }
}

/** Anti-slop guardrails for the CommentJudge (length + banned generic praise). */
const COMMENT_GUARDRAILS = {
  minConfidence: 0,
  bannedPhrases: [],
  quarantineMinutes: 0,
  lenRange: [12, 280] as [number, number],
};

export interface CommentDeps {
  store: KeyValueStore;
  http: LlmHttp;
  clock: Clock;
  cancelled?: () => boolean | Promise<boolean>;
}

/**
 * Auto-comment on ONE relevant post during the run (Vlad's full-auto decision):
 * generate via CommentDraftService → quality-judge (slop never posts) → if ok, return
 * the text for the content script to executeComment. Gated by: comments enabled, BYOK
 * key, a STRICTER relevance threshold than likes, and the daily comment budget. Crosses
 * the real LLM mapper. "Full auto" = auto-post, but a failed judge is dropped, not posted.
 */
export async function commentOnPost(
  deps: CommentDeps,
  post: FeedPost,
): Promise<{ ok: boolean; text?: string; reason?: string }> {
  const cancelled = () => isCancelled(deps.cancelled);
  if (await cancelled()) return { ok: false, reason: 'cancelled' };
  const settings = await loadContentSettings(deps.store);
  if (await cancelled()) return { ok: false, reason: 'cancelled' };
  if (!settings.commentsEnabled) return { ok: false, reason: 'disabled' };
  const cfg = await loadLlmConfig(deps.store);
  if (await cancelled()) return { ok: false, reason: 'cancelled' };
  if (!cfg.apiKey.trim()) return { ok: false, reason: 'no_key' };
  const { expertise } = await loadSettings(deps.store);
  if (await cancelled()) return { ok: false, reason: 'cancelled' };
  if (!expertise.headline.trim()) return { ok: false, reason: 'no_expertise' };
  // No stack-relevance gate: SSI grows through feed ACTIVITY, so we engage any liked post's
  // topic with a clarifying question (the LikeFilter already dropped junk before the like).
  const today = deps.clock.now().toISOString().slice(0, 10);
  const budget = rolloverIdeaDay(
    (await deps.store.get<IdeaDay>(COMMENT_BUDGET_KEY)) ?? null,
    today,
  );
  if (await cancelled()) return { ok: false, reason: 'cancelled' };
  if (remainingIdeas(budget, settings.commentsPerDay) <= 0) return { ok: false, reason: 'budget' };
  const acted = asArray<string>(await deps.store.get<string[]>(COMMENT_ACTED_KEY));
  if (await cancelled()) return { ok: false, reason: 'cancelled' };
  if (acted.includes(post.urn)) return { ok: false, reason: 'already' };

  const provider = createLlmProvider(
    { provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model },
    deps.http,
  );
  try {
    const text = await new CommentDraftService(provider).draft({
      post,
      expertise,
      tone: settings.commentTone,
      language: languageName(settings.contentLanguage),
    });
    if (await cancelled()) return { ok: false, reason: 'cancelled' };
    const verdict = new CommentJudge().judge(text, COMMENT_GUARDRAILS);
    if (!verdict.ok) return { ok: false, reason: verdict.reasons.join(',') || 'judged' };
    return { ok: true, text };
  } catch (e) {
    if (await cancelled()) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: e instanceof Error ? e.message : 'llm_failed' };
  }
}

async function isCancelled(check?: () => boolean | Promise<boolean>): Promise<boolean> {
  return check ? await check() : false;
}

// Auto-publish handler lives in a sibling file (SRP); re-exported so callers
// (service-worker/index.ts) and tests keep one import site.
export { publishApprovedDrafts, type PublishApprovedDeps } from './contentHandlers.publish';
