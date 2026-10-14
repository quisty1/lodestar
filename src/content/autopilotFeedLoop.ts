import { FeedAccumulator } from '@lib/feed/FeedAccumulator';
import { LikeFilter } from '@lib/engagement/LikeFilter';
import type { HumanDelay } from '@lib/engagement/HumanDelay';
import { rollComment } from '@lib/engagement/commentRoll';
import { HumanBreakPolicy } from '@lib/autopilot/HumanBreakPolicy';
import type { RiskMarker } from '@lib/autopilot/RiskAssessor';
import { MathRandomRng } from '@/adapters/MathRandomRng';
import {
  SCANNING,
  LIKING,
  COMMENTING,
  GENERATING_IDEAS,
  COLLECTING_IDEAS,
  pauseLabel,
  breakCountdownLabel,
} from '@lib/autopilot/statusLabels';
import type { StopReason } from '@lib/types';
import type { ContentRunSession } from './runSession';
import { runWithEngagementOwner } from './engagementOwner';
import {
  showActivity,
  setActivityLabel,
  countdownActivity,
  clearActivity,
} from './activityOverlay';
import { runScopedContentLoop } from './runLoopLifecycle';
import { settleRunDecision, settleRunResult } from './deferredRunResult';
import type { EffectRuntimeClient } from './EffectRuntimeClient';
import { actionObservation } from './effectAction';
import { executeLikeEffect } from './domActions';
import { harvestByScrolling } from './feedHarvest';
import type { FeedReader } from '@lib/feed/FeedReader';
import { ask } from './contentTiming';
import { commentAfterLike } from './feedCommentStep';

const IDEA_TARGET = 25;

export function detectRisk(): RiskMarker | null {
  if (document.querySelector('iframe[src*="captcha" i], [id*="captcha" i]')) return 'captcha';
  if (location.pathname.includes('/checkpoint')) return 'challenge';
  return null;
}

export async function endRun(
  runSession: ContentRunSession,
  runId: string,
  reason: StopReason,
): Promise<void> {
  runSession.finish(runId);
  await ask({ type: 'AUTOPILOT_ENDED', runId, reason });
}

export interface FeedLoopDeps {
  runSession: ContentRunSession;
  effectClient: EffectRuntimeClient;
  likeFilter: LikeFilter;
  humanBreak: HumanBreakPolicy;
  commentRng: MathRandomRng;
  delay: HumanDelay;
  feed: FeedReader;
}

export async function runAutopilotLoop(
  deps: FeedLoopDeps,
  runId: string,
  modules: { engagement: boolean; content: boolean; comments: boolean },
): Promise<void> {
  const { runSession, effectClient, likeFilter, humanBreak, commentRng, delay, feed } = deps;
  const actedUrns = new Set<string>();
  let actionsSinceBreak = 0;
  let emptyHarvests = 0;
  let extractedThisRun = false;
  let extractAtEnd = false;
  const runBuffer = new FeedAccumulator();
  const wantLike = modules.engagement;
  const wantIdeas = modules.content;
  const wantComments = modules.comments;
  let commentedThisRun = false;
  const idleLabel = wantLike ? SCANNING : COLLECTING_IDEAS;
  const finish = (reason: StopReason) => endRun(runSession, runId, reason);
  await runScopedContentLoop(runId, {
    session: runSession,
    execute: () =>
      runWithEngagementOwner(
        document,
        {
          required: wantLike,
          shouldAbort: () => !runSession.isActive(runId),
        },
        async (ownerName) => {
          showActivity(document, idleLabel);
          while (runSession.isActive(runId)) {
            setActivityLabel(idleLabel);
            const posts = await harvestByScrolling(
              feed,
              delay,
              25,
              () => !runSession.isActive(runId),
            );
            if (!runSession.isActive(runId)) break;
            if (wantIdeas && !extractedThisRun) runBuffer.add(posts);
            if (wantIdeas && !extractedThisRun && runBuffer.size() >= IDEA_TARGET) {
              setActivityLabel(GENERATING_IDEAS);
              const accepted = await settleRunResult(
                runSession,
                runId,
                ask({ type: 'EXTRACT_RUN_IDEAS', runId, posts: runBuffer.items() }),
                (response) => response !== undefined,
              );
              if (!runSession.isActive(runId)) break;
              if (accepted) extractedThisRun = true;
            }
            if (wantLike) {
              const { likeable } = likeFilter.select(posts, undefined, ownerName);
              const fresh = likeable.filter((post) => !actedUrns.has(post.urn));
              if (fresh.length === 0) {
                if (++emptyHarvests >= 2) {
                  extractAtEnd = true;
                  await finish('feed_exhausted');
                  break;
                }
                continue;
              }
              emptyHarvests = 0;
              for (const post of fresh) {
                if (!runSession.isActive(runId)) break;
                const risk = detectRisk();
                if (risk) await ask({ type: 'AUTOPILOT_RISK', runId, marker: risk });
                const decision = await settleRunDecision(
                  runSession,
                  runId,
                  ask<{ action: string; waitMs?: number; reason?: StopReason }>({
                    type: 'AUTOPILOT_MAY_ACT',
                    runId,
                    actionType: 'like',
                  }),
                );
                if (decision?.action === 'stop') {
                  if (decision.reason !== 'manual') extractAtEnd = true;
                  runSession.finish(runId);
                  break;
                }
                if (!runSession.isActive(runId)) break;
                if (!decision) {
                  await finish('manual');
                  break;
                }
                if (decision.action === 'wait') {
                  await countdownActivity(
                    decision.waitMs ?? 30_000,
                    pauseLabel,
                    () => !runSession.isActive(runId),
                  );
                  continue;
                }
                setActivityLabel(LIKING);
                const like = await effectClient.execute(
                  runId,
                  { kind: 'like', targetKey: post.urn, postUrn: post.urn },
                  async (gate) =>
                    actionObservation(
                      await executeLikeEffect(
                        document,
                        post.urn,
                        () => gate.commit(),
                        () => !runSession.isActive(runId),
                      ),
                    ),
                  `${runId}:like:${post.urn}`,
                );
                if (like.reserved && like.settled !== true) {
                  await finish('error');
                  break;
                }
                actedUrns.add(post.urn);
                if (like.outcome === 'confirmed') actionsSinceBreak += 1;
                if (
                  like.outcome === 'confirmed' &&
                  wantComments &&
                  (!commentedThisRun || rollComment(commentRng))
                ) {
                  setActivityLabel(COMMENTING);
                  commentedThisRun = await commentAfterLike({
                    runId,
                    post,
                    runSession,
                    effectClient,
                    delay,
                    endRun: finish,
                    commentedThisRun,
                  });
                  if (!runSession.isActive(runId)) break;
                }
                await countdownActivity(
                  delay.nextMs(8000, 45000),
                  pauseLabel,
                  () => !runSession.isActive(runId),
                );
                const breakMs = humanBreak.nextBreakMs(actionsSinceBreak, new MathRandomRng());
                if (breakMs > 0) {
                  actionsSinceBreak = 0;
                  await countdownActivity(
                    breakMs,
                    breakCountdownLabel,
                    () => !runSession.isActive(runId),
                  );
                }
              }
            } else {
              if (extractedThisRun) {
                await finish('feed_exhausted');
                break;
              }
              if (++emptyHarvests >= 3) {
                extractAtEnd = true;
                await finish('feed_exhausted');
                break;
              }
            }
          }
        },
      ),
    endRun: (scopedRunId, reason) => endRun(runSession, scopedRunId, reason),
    teardown: async () => {
      if (extractAtEnd && wantIdeas && !extractedThisRun) {
        await ask({ type: 'EXTRACT_RUN_IDEAS', runId, posts: runBuffer.items() });
      }
    },
    clearActivity: () => {
      clearActivity(document);
    },
  });
}
