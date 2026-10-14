import type { AutopilotState } from '@lib/types';
import { isScopedAutopilotState } from '@lib/autopilot/RunCoordinator';
import { isContentPong, isFeedUrl, type ContentPong, type TargetTab } from './runTarget';

export interface RunSupervisorDependencies {
  getState(): Promise<AutopilotState | null>;
  recoverInterrupted(): Promise<unknown>;
  finalizeInterrupted(runId: string): Promise<void>;
  getTab(tabId: number): Promise<TargetTab | null>;
  ping(tabId: number): Promise<ContentPong | null>;
  reinject?(tabId: number): Promise<boolean>;
  sleep?(ms: number): Promise<void>;
}

export interface RunTabUpdate {
  url?: string;
  status?: 'loading' | 'complete';
}

export class RunSupervisor {
  private readonly launches = new Map<string, number>();

  constructor(private readonly deps: RunSupervisorDependencies) {}

  trackLaunch(runId: string, launch: Promise<unknown>): void {
    const release = this.claimLaunch(runId);
    void launch.finally(release).catch(() => undefined);
  }

  claimLaunch(runId: string): () => void {
    this.launches.set(runId, (this.launches.get(runId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.launches.get(runId) ?? 1) - 1;
      if (remaining <= 0) this.launches.delete(runId);
      else this.launches.set(runId, remaining);
    };
  }

  async reconcile(): Promise<void> {
    const state = await this.deps.getState();
    if (!state) return;
    if (
      !isScopedAutopilotState(state) ||
      state.phase === 'stopping' ||
      state.phase === 'finalizing'
    ) {
      await this.deps.recoverInterrupted();
      return;
    }
    if (!state.running || state.phase === 'finished') return;
    if (this.launches.has(state.runId)) return;
    if (state.phase !== 'feed_loop') {
      await this.deps.finalizeInterrupted(state.runId);
      return;
    }
    if (typeof state.tabId !== 'number') {
      await this.deps.finalizeInterrupted(state.runId);
      return;
    }
    if (!(await this.feedLoopIsAlive({ ...state, tabId: state.tabId }))) {
      await this.deps.finalizeInterrupted(state.runId);
    }
  }

  async onTabRemoved(tabId: number): Promise<void> {
    const state = await this.deps.getState();
    if (isLiveFeedTarget(state, tabId)) await this.deps.finalizeInterrupted(state.runId);
  }

  async onTabUpdated(tabId: number, change: RunTabUpdate): Promise<void> {
    const state = await this.deps.getState();
    if (!isLiveFeedTarget(state, tabId)) return;
    if (change.url !== undefined && !isFeedUrl(change.url)) {
      await this.deps.finalizeInterrupted(state.runId);
      return;
    }
    if (change.status === 'loading') return;
    if (
      change.status === 'complete' &&
      typeof state.tabId === 'number' &&
      !(await this.feedLoopRecovers({
        ...state,
        runId: state.runId,
        tabId: state.tabId,
      }))
    ) {
      await this.deps.finalizeInterrupted(state.runId);
    }
  }

  private async feedLoopRecovers(
    state: AutopilotState & { runId: string; tabId: number },
  ): Promise<boolean> {
    let reinjected = false;
    for (let attempt = 0; attempt < RECOVERY_ATTEMPTS; attempt += 1) {
      if (await this.feedLoopIsAlive(state)) return true;
      if (!reinjected) {
        reinjected = true;
        await this.deps.reinject?.(state.tabId).catch(() => false);
      }
      if (attempt + 1 < RECOVERY_ATTEMPTS) await this.waitForRecovery();
    }
    return false;
  }

  private waitForRecovery(): Promise<void> {
    return (this.deps.sleep ?? sleep)(RECOVERY_INTERVAL_MS);
  }

  private async feedLoopIsAlive(
    state: AutopilotState & { runId: string; tabId: number },
  ): Promise<boolean> {
    const tab = await this.deps.getTab(state.tabId).catch(() => null);
    if (!tab || tab.status !== 'complete' || !isFeedUrl(tab.url)) return false;
    const pong = await this.deps.ping(state.tabId).catch(() => null);
    return (
      isContentPong(pong) &&
      pong.surface === 'feed' &&
      pong.capabilities.feed !== 'unsupported_dom' &&
      pong.activeRunId === state.runId
    );
  }
}

export function startWorkerKeepAlive(
  ping: () => Promise<unknown>,
  intervalMs = 25_000,
): () => void {
  const timer = setInterval(() => {
    void ping().catch(() => undefined);
  }, intervalMs);
  return () => {
    clearInterval(timer);
  };
}

const RECOVERY_ATTEMPTS = 3;
const RECOVERY_INTERVAL_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLiveFeedTarget(
  state: AutopilotState | null,
  tabId: number,
): state is AutopilotState & { runId: string } {
  return Boolean(
    state?.running &&
    state.phase === 'feed_loop' &&
    state.tabId === tabId &&
    typeof state.runId === 'string',
  );
}
