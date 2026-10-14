import type { DrainResult } from '@lib/autopilot/EffectService';
import type { AutopilotState, RunReport, StopReason } from '@lib/types';

interface StoppingState extends Partial<AutopilotState> {
  runId?: string;
  phase?: AutopilotState['phase'];
  tabId?: number;
}

export interface EffectRunFinalizerDependencies {
  requestStop(runId: string, reason: StopReason): Promise<StoppingState | null>;
  reconcile?(runId: string): Promise<unknown>;
  stopContent(tabId: number | undefined, runId: string): Promise<void>;
  clearActivity(tabId: number | undefined): Promise<void>;
  drain(runId: string): Promise<DrainResult>;
  finalize(runId: string): Promise<RunReport | null>;
  broadcastReport(report: RunReport): void;
  scheduleRetry?(retry: () => void, delayMs: number): void;
  scheduleDurableRetry?(runId: string, delayMs: number): void;
  clearDurableRetry?(runId: string): void;
}

/** Persists STOP synchronously; drains committed effects in a deduplicated background tail. */
export class EffectRunFinalizer {
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly retryCounts = new Map<string, number>();
  private readonly completed = new Set<string>();

  constructor(private readonly dependencies: EffectRunFinalizerDependencies) {}

  async request(runId: string, reason: StopReason): Promise<StoppingState | null> {
    const state = await this.dependencies.requestStop(runId, reason);
    if (state && state.phase !== 'finished') {
      this.armDurableRetry(runId);
      void this.finish(runId, state);
    }
    return state;
  }

  finish(runId: string, state: StoppingState = {}): Promise<void> {
    if (this.completed.has(runId)) return Promise.resolve();
    this.armDurableRetry(runId);
    const existing = this.tasks.get(runId);
    if (existing) return existing;
    const task = this.complete(runId, state).finally(() => {
      if (this.tasks.get(runId) === task) this.tasks.delete(runId);
    });
    this.tasks.set(runId, task);
    return task;
  }

  isFinishing(runId: string): boolean {
    return this.tasks.has(runId);
  }

  async wait(runId: string): Promise<void> {
    await this.tasks.get(runId);
  }

  private async complete(runId: string, state: StoppingState): Promise<void> {
    try {
      await this.dependencies.stopContent(state.tabId, runId);
      await this.dependencies.clearActivity(state.tabId);
      await this.dependencies.reconcile?.(runId);
      const drained = await this.dependencies.drain(runId);
      if (!drained.drained) {
        this.retry(runId, state);
        return;
      }
      const report = await this.dependencies.finalize(runId);
      if (report) {
        this.retryCounts.delete(runId);
        this.completed.add(runId);
        try {
          this.dependencies.clearDurableRetry?.(runId);
        } catch {
          // Report persistence is authoritative; alarm cleanup is best-effort.
        }
        this.dependencies.broadcastReport(report);
      } else {
        this.retry(runId, state);
      }
    } catch {
      this.retry(runId, state);
    }
  }

  private retry(runId: string, state: StoppingState): void {
    const retries = (this.retryCounts.get(runId) ?? 0) + 1;
    this.retryCounts.set(runId, retries);
    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(5, retries - 1));
    const retry = () => {
      void this.finish(runId, state);
    };
    if (this.dependencies.scheduleRetry) this.dependencies.scheduleRetry(retry, delayMs);
    else setTimeout(retry, delayMs);
  }

  private armDurableRetry(runId: string): void {
    try {
      this.dependencies.scheduleDurableRetry?.(runId, 0);
    } catch {
      // The in-memory retry remains available if Chrome rejects alarm creation.
    }
  }
}
