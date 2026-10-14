import type { RunCoordinator } from '@lib/autopilot/RunCoordinator';
import type { ModuleOutcome, StopReason } from '@lib/types';
import type { FeedPreparation } from './runTarget';

export class NavigationFailedError extends Error {
  constructor() {
    super('LinkedIn navigation failed');
    this.name = 'NavigationFailedError';
  }
}

export interface RunLaunchConfig {
  tabId: number;
  enabled: {
    engagement: boolean;
    profileViews: boolean;
    smartConnect: boolean;
    content: boolean;
  };
  loopModules: { engagement: boolean; content: boolean; comments: boolean };
  labels: { scanning: string; collecting: string };
}

export interface RunLaunchDependencies {
  coordinator: RunCoordinator;
  runViews(): Promise<ModuleOutcome>;
  runAccept?(): Promise<number>;
  runConnect(): Promise<ModuleOutcome>;
  runPublishing(): Promise<ModuleOutcome>;
  prepareFeed(runId: string): Promise<FeedPreparation>;
  startFeedLoop(
    runId: string,
    modules: { engagement: boolean; content: boolean; comments: boolean },
  ): Promise<FeedLoopStart>;
  finalize(runId: string, reason: StopReason): Promise<void>;
  startKeepAlive(): () => void;
  clearActivity(): Promise<void> | void;
}

/** Executes one scoped launch. The coordinator remains the only run-state writer. */
export async function launchAutopilotRun(
  runId: string,
  config: RunLaunchConfig,
  deps: RunLaunchDependencies,
): Promise<void> {
  const stopKeepAlive = deps.startKeepAlive();
  let feedLoopOwnsActivity = false;
  try {
    await deps.coordinator.recordOutcome(runId, 'engagement', {
      executed: 0,
      reason: config.enabled.engagement ? 'done' : 'disabled',
    });

    if (!(await active(deps, runId))) return;
    if (config.enabled.profileViews) {
      if (!(await deps.coordinator.setPhase(runId, 'profile_views'))) return;
      const outcome = await deps.runViews();
      await deps.coordinator.recordOutcome(runId, 'profile_views', outcome);
      if (isNavigationFailure(outcome)) {
        await finish(deps, runId, 'navigation_failed');
        return;
      }
    } else {
      await deps.coordinator.recordOutcome(runId, 'profile_views', {
        executed: 0,
        reason: 'disabled',
      });
    }

    if (!(await active(deps, runId))) return;
    if (config.enabled.smartConnect && deps.runAccept) {
      try {
        await deps.runAccept();
      } catch (error) {
        if (!(error instanceof NavigationFailedError)) throw error;
      }
      if (!(await active(deps, runId))) return;
    }
    if (config.enabled.smartConnect) {
      if (!(await deps.coordinator.setPhase(runId, 'smart_connect'))) return;
      const outcome = await deps.runConnect();
      await deps.coordinator.recordOutcome(runId, 'smart_connect', outcome);
      if (isNavigationFailure(outcome)) {
        await finish(deps, runId, 'navigation_failed');
        return;
      }
    } else {
      await deps.coordinator.recordOutcome(runId, 'smart_connect', {
        executed: 0,
        reason: 'disabled',
      });
    }

    if (!(await active(deps, runId))) return;
    if (!(await deps.coordinator.setPhase(runId, 'publishing'))) return;
    const publishing = await deps.runPublishing();
    await deps.coordinator.recordOutcome(runId, 'content', publishing);
    if (isNavigationFailure(publishing)) {
      await finish(deps, runId, 'navigation_failed');
      return;
    }

    if (!(await active(deps, runId))) return;
    const loopHasWork = config.loopModules.engagement || config.loopModules.content;
    if (!loopHasWork) {
      await finish(deps, runId, 'completed');
      return;
    }

    if (
      !(await deps.coordinator.setPhase(runId, 'feed_preflight', {
        expectedUrl: 'https://www.linkedin.com/feed/',
      }))
    )
      return;
    const prepared = await deps.prepareFeed(runId);
    if (!prepared.ok) {
      await finish(deps, runId, prepared.reason);
      return;
    }
    if (!(await active(deps, runId))) return;

    const label = config.loopModules.engagement ? config.labels.scanning : config.labels.collecting;
    if (!(await deps.coordinator.setStage(runId, label, 'https://www.linkedin.com/feed/'))) return;
    const started = await deps.startFeedLoop(runId, config.loopModules);
    if (!started.ok) {
      await finish(deps, runId, started.reason);
      return;
    }
    feedLoopOwnsActivity =
      (await deps.coordinator.setPhase(runId, 'feed_loop', {
        stage: label,
        expectedUrl: 'https://www.linkedin.com/feed/',
      })) !== null;
  } catch (error) {
    if (await active(deps, runId)) {
      await finish(
        deps,
        runId,
        error instanceof NavigationFailedError ? 'navigation_failed' : 'error',
      );
    }
  } finally {
    stopKeepAlive();
    if (!feedLoopOwnsActivity) await deps.clearActivity();
  }
}

function active(deps: RunLaunchDependencies, runId: string): Promise<boolean> {
  return deps.coordinator.isActive(runId);
}

async function finish(
  deps: RunLaunchDependencies,
  runId: string,
  reason: StopReason,
): Promise<void> {
  await deps.finalize(runId, reason);
}

function isNavigationFailure(outcome: ModuleOutcome): boolean {
  return outcome.reason === 'nav_failed' || outcome.reason === 'navigation_failed';
}

export type FeedLoopAck = { ok?: boolean; runId?: string; error?: string } | null;

export type FeedLoopStart =
  { ok: true } | { ok: false; reason: 'unsupported_dom' | 'navigation_failed' | 'error' };

export function feedLoopFailure(error: string | undefined): FeedLoopStart {
  if (error === 'unsupported_dom') return { ok: false, reason: 'unsupported_dom' };
  if (error === 'wrong-page') return { ok: false, reason: 'navigation_failed' };
  return { ok: false, reason: 'error' };
}

function feedLoopAccepted(response: FeedLoopAck, runId: string): boolean {
  return response?.ok === true && response.runId === runId;
}

function asFeedLoopAck(value: unknown): FeedLoopAck {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.ok === 'boolean' ? { ok: record.ok } : {}),
    ...(typeof record.runId === 'string' ? { runId: record.runId } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  };
}

/** Retries a detached content script once. A wrong page is not a markup failure. */
export async function openFeedLoop(options: {
  runId: string;
  runLoop: () => Promise<unknown>;
  attach: () => Promise<unknown>;
}): Promise<FeedLoopStart> {
  const first = asFeedLoopAck(await options.runLoop().catch(() => null));
  if (feedLoopAccepted(first, options.runId)) return { ok: true };
  if (first?.error === 'run-not-attached') {
    const attached = asFeedLoopAck(await options.attach().catch(() => null));
    if (feedLoopAccepted(attached, options.runId)) {
      const second = asFeedLoopAck(await options.runLoop().catch(() => null));
      if (feedLoopAccepted(second, options.runId)) return { ok: true };
      return feedLoopFailure(second?.error);
    }
  }
  return feedLoopFailure(first?.error);
}
