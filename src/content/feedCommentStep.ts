import type { HumanDelay } from '@lib/engagement/HumanDelay';
import { pauseLabel } from '@lib/autopilot/statusLabels';
import type { FeedPost, StopReason } from '@lib/types';
import { executeComment } from './domActions';
import { actionObservation } from './effectAction';
import type { EffectRuntimeClient } from './EffectRuntimeClient';
import type { ContentRunSession } from './runSession';
import { countdownActivity } from './activityOverlay';
import { settleRunResult } from './deferredRunResult';
import { ask } from './contentTiming';

export async function commentAfterLike(input: {
  runId: string;
  post: FeedPost;
  runSession: ContentRunSession;
  effectClient: EffectRuntimeClient;
  delay: HumanDelay;
  endRun: (reason: StopReason) => Promise<void>;
  commentedThisRun: boolean;
}): Promise<boolean> {
  const { runId, post, runSession, effectClient, delay, endRun } = input;
  let commented = input.commentedThisRun;
  await settleRunResult(
    runSession,
    runId,
    ask<{ ok: boolean; text?: string }>({
      type: 'COMMENT_ON_POST',
      runId,
      post,
    }),
    async (comment) => {
      const text = comment?.ok ? comment.text : undefined;
      if (!text) return;
      const commentEffect = await effectClient.execute(
        runId,
        { kind: 'comment', targetKey: post.urn, postUrn: post.urn },
        async (gate) =>
          actionObservation(
            await executeComment(
              document,
              post.urn,
              text,
              delay,
              () => !runSession.isActive(runId),
              () => gate.commit(),
            ),
          ),
        `${runId}:comment:${post.urn}`,
      );
      if (commentEffect.reserved && commentEffect.settled !== true) {
        await endRun('error');
        return;
      }
      if (commentEffect.outcome === 'confirmed') {
        commented = true;
        void chrome.runtime.sendMessage({
          type: 'RECORD_COMMENT',
          entry: {
            id: `${runId}:${post.urn}`,
            text,
            author: post.authorName || 'пост',
            postUrn: post.urn,
            at: new Date().toISOString(),
          },
        });
      }
      if (runSession.isActive(runId)) {
        await countdownActivity(
          delay.nextMs(8000, 45000),
          pauseLabel,
          () => !runSession.isActive(runId),
        );
      }
    },
  );
  return commented;
}
