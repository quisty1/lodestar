import type { AutopilotState, FeedPost } from '@lib/types';

type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

export interface RunContentRuntimeEvent {
  addListener(listener: RuntimeListener): void;
}

export interface RunContentRuntimeDependencies {
  isActive(runId: string): Promise<boolean>;
  canExtract(runId: string): Promise<boolean>;
  showIdeaActivity(runId: string): Promise<void>;
  hideIdeaActivity(runId: string): Promise<void>;
  extract(
    runId: string,
    posts: FeedPost[],
    cancelled: () => Promise<boolean>,
  ): Promise<{ stored: number; error?: string }>;
  comment(
    runId: string,
    post: FeedPost,
    cancelled: () => Promise<boolean>,
  ): Promise<{ ok: boolean; text?: string; reason?: string }>;
}

type RawRunContentMessage =
  | { type: 'EXTRACT_RUN_IDEAS'; runId?: unknown; posts?: unknown }
  | { type: 'COMMENT_ON_POST'; runId?: unknown; post?: unknown };

const NATURAL_IDEA_ENDS = new Set(['feed_exhausted', 'budget', 'risk']);

/**
 * Owns the two LLM-backed run messages. Keeping this as a synchronous listener
 * factory preserves Chrome's `return true` contract while making the production
 * callback testable without importing the side-effectful service-worker entry.
 */
export function registerRunContentRuntime(
  event: RunContentRuntimeEvent,
  dependencies: RunContentRuntimeDependencies,
): void {
  event.addListener((raw, _sender, sendResponse) => {
    if (!isRunContentMessage(raw)) return false;

    const failed =
      raw.type === 'EXTRACT_RUN_IDEAS'
        ? { stored: 0, error: 'action-failed' }
        : { ok: false, reason: 'action-failed' };
    void dispatch(raw, dependencies).then(sendResponse, () => {
      sendResponse(failed);
    });
    return true;
  });
}

export function permitsFinishedIdeaCatchup(state: AutopilotState | null, runId: string): boolean {
  return (
    state?.runId === runId &&
    state.phase === 'finished' &&
    state.stopReason !== undefined &&
    NATURAL_IDEA_ENDS.has(state.stopReason)
  );
}

async function dispatch(
  message: RawRunContentMessage,
  dependencies: RunContentRuntimeDependencies,
): Promise<unknown> {
  const runId = message.runId;
  if (typeof runId !== 'string' || runId.length === 0) {
    return message.type === 'EXTRACT_RUN_IDEAS'
      ? { stored: 0, error: 'cancelled', reason: 'run-inactive' }
      : { ok: false, reason: 'run-inactive' };
  }

  if (message.type === 'COMMENT_ON_POST') {
    if (!isFeedPost(message.post)) return { ok: false, reason: 'invalid-message' };
    const cancelled = async () => !(await dependencies.isActive(runId));
    if (await cancelled()) return { ok: false, reason: 'cancelled' };
    return dependencies.comment(runId, message.post, cancelled);
  }

  if (!Array.isArray(message.posts) || !message.posts.every(isFeedPost)) {
    return { stored: 0, error: 'invalid-message' };
  }
  const startedActive = await dependencies.isActive(runId);
  if (!startedActive && !(await dependencies.canExtract(runId))) {
    return { stored: 0, error: 'cancelled' };
  }
  // An extraction that began mid-run remains active-scoped; finalization must
  // cancel it. Only a request that ARRIVED after a natural finish gets the
  // narrow same-run settlement allowance.
  const cancelled = startedActive
    ? async () => !(await dependencies.isActive(runId))
    : async () => !(await dependencies.canExtract(runId));

  let activityShown = false;
  try {
    if (startedActive) {
      await dependencies.showIdeaActivity(runId);
      activityShown = true;
      if (await cancelled()) return { stored: 0, error: 'cancelled' };
    }
    return await dependencies.extract(runId, message.posts, cancelled);
  } finally {
    // A STOP/finalize or replacement run owns the page now. Never let the old
    // completion clear the new run's activity indicator.
    if (activityShown && (await dependencies.isActive(runId))) {
      await dependencies.hideIdeaActivity(runId);
    }
  }
}

function isRunContentMessage(value: unknown): value is RawRunContentMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'EXTRACT_RUN_IDEAS' || type === 'COMMENT_ON_POST';
}

function isFeedPost(value: unknown): value is FeedPost {
  if (typeof value !== 'object' || value === null) return false;
  const post = value as Partial<FeedPost>;
  return (
    typeof post.urn === 'string' &&
    typeof post.authorName === 'string' &&
    (post.authorHeadline === undefined || typeof post.authorHeadline === 'string') &&
    typeof post.text === 'string'
  );
}
