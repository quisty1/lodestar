import type { Clock } from '../ports';
import type { EffectOutcome, EffectReceipt, RunReport } from '../types';
import {
  isScopedAutopilotState,
  type RunCoordinator,
  type SettleEffectOptions,
  type SettleEffectResult,
} from './RunCoordinator';

export interface EffectAccountingPort {
  apply(receipt: EffectReceipt): Promise<void>;
}

export interface EffectServiceDependencies {
  coordinator: RunCoordinator;
  accountant: EffectAccountingPort;
  clock: Clock;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollMs?: number;
}

export interface DrainResult {
  drained: boolean;
  timedOut: boolean;
  expired: number;
}

/**
 * Coordinates settlement/replay without waiting inside the run lock.
 * Production wires one service + accountant pair per worker/store.
 */
export class EffectService {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly accountingTasks = new Map<string, Promise<EffectReceipt>>();

  constructor(private readonly dependencies: EffectServiceDependencies) {
    this.sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = Math.max(0, dependencies.timeoutMs ?? 15_000);
    this.pollMs = Math.max(1, dependencies.pollMs ?? 250);
  }

  async settle(
    runId: string,
    effectId: string,
    requestId: string,
    outcome: EffectOutcome,
    options: SettleEffectOptions = {},
  ): Promise<SettleEffectResult> {
    const result = await this.dependencies.coordinator.settleEffect(
      runId,
      effectId,
      requestId,
      outcome,
      options,
    );
    if (result.kind === 'rejected') return result;
    const receipt = await this.applyAndMark(runId, result.receipt);
    return { ...result, receipt };
  }

  async replayPending(runId: string): Promise<number> {
    return this.replayPendingBatch(runId, this.timeoutMs);
  }

  private async replayPendingBatch(runId: string, waitMs: number): Promise<number> {
    const pending = await this.dependencies.coordinator.pendingEffects(runId);
    if (!pending || pending.blocked) return 0;
    let applied = 0;
    const tasks = pending.accounting.map((receipt) =>
      this.accountingTask(runId, receipt).then(
        (result) => {
          if (result.accounting === 'applied') applied += 1;
        },
        () => undefined,
      ),
    );
    await waitForTasks(tasks, waitMs);
    return applied;
  }

  async drain(runId: string): Promise<DrainResult> {
    const startedAt = this.dependencies.clock.now().getTime();
    const accountingDeadline = Date.now() + this.timeoutMs;
    const observedCommittedAt = new Map<string, number>();
    let finalDeadline = startedAt + this.timeoutMs;
    let expiredCount = 0;
    let timedOut = false;
    while (true) {
      await this.replayPendingBatch(
        runId,
        Math.min(this.pollMs, Math.max(0, accountingDeadline - Date.now())),
      );
      let pending = await this.dependencies.coordinator.pendingEffects(runId);
      if (pending?.blocked) return { drained: false, timedOut, expired: expiredCount };
      if (!pending || (!pending.committed.length && !pending.accounting.length)) {
        return { drained: true, timedOut, expired: expiredCount };
      }

      const now = this.dependencies.clock.now().getTime();
      const committedDeadlines = pending.committed.map((lease) => {
        let observed = observedCommittedAt.get(lease.effectId);
        if (observed === undefined) {
          observed = Math.min(Date.parse(lease.committedAt ?? lease.reservedAt), now);
          observedCommittedAt.set(lease.effectId, observed);
        }
        return observed + this.timeoutMs;
      });
      if (committedDeadlines.length) finalDeadline = Math.max(finalDeadline, ...committedDeadlines);

      const cutoff = new Date(now - this.timeoutMs).toISOString();
      const dueEffectIds = pending.committed
        .filter((lease) => (observedCommittedAt.get(lease.effectId) ?? now) + this.timeoutMs <= now)
        .map((lease) => lease.effectId);
      const expired = await this.dependencies.coordinator.expireCommittedEffects(
        runId,
        cutoff,
        dueEffectIds,
      );
      if (expired.length) {
        expiredCount += expired.length;
        timedOut = true;
        await this.replayPendingBatch(
          runId,
          Math.min(this.pollMs, Math.max(0, accountingDeadline - Date.now())),
        );
        pending = await this.dependencies.coordinator.pendingEffects(runId);
        if (pending?.blocked) return { drained: false, timedOut, expired: expiredCount };
        if (!pending || (!pending.committed.length && !pending.accounting.length)) {
          return { drained: true, timedOut, expired: expiredCount };
        }
      }

      const current = this.dependencies.clock.now().getTime();
      if (current >= finalDeadline) {
        return { drained: false, timedOut: true, expired: expiredCount };
      }
      const nextCommittedDeadline = Math.min(
        ...pending.committed.map(
          (lease) => (observedCommittedAt.get(lease.effectId) ?? current) + this.timeoutMs,
        ),
      );
      const wakeAt = Math.min(current + this.pollMs, finalDeadline, nextCommittedDeadline);
      await this.sleep(Math.max(1, wakeAt - current));
    }
  }

  /** Reconciles a cold worker; healthy committed work remains eligible for a late settle. */
  async recover(): Promise<RunReport | null> {
    const state = await this.dependencies.coordinator.getState();
    if (!state) return null;
    if (!isScopedAutopilotState(state)) return this.dependencies.coordinator.recoverInterrupted();
    if (state.phase === 'finished') return this.dependencies.coordinator.recoverInterrupted();

    const reconciliation = await this.dependencies.coordinator.reconcileEffects(state.runId);
    if (reconciliation.blocked) return null;
    await this.replayPendingBatch(state.runId, Math.min(this.pollMs, this.timeoutMs));
    const reconciled = await this.dependencies.coordinator.getState();
    if (reconciled?.runId !== state.runId) return null;
    if (reconciled.running && reconciled.phase !== 'stopping' && reconciled.phase !== 'finalizing')
      return null;

    while (true) {
      const drained = await this.drain(state.runId);
      if (!drained.drained) return null;
      const report = await this.dependencies.coordinator.recoverInterrupted();
      if (report) return report;
      const current = await this.dependencies.coordinator.getState();
      if (!isScopedAutopilotState(current) || current.runId !== state.runId) return null;
      if (current.phase === 'finished') return this.dependencies.coordinator.recoverInterrupted();
      if (current.phase !== 'stopping' && current.phase !== 'finalizing') return null;
      const pending = await this.dependencies.coordinator.pendingEffects(state.runId);
      if (!pending || pending.blocked) return null;
    }
  }

  private async applyAndMark(runId: string, receipt: EffectReceipt): Promise<EffectReceipt> {
    if (receipt.accounting === 'applied') return receipt;
    await this.dependencies.accountant.apply(receipt);
    const applied = await this.dependencies.coordinator.markEffectAccounted(
      runId,
      receipt.effectId,
      { settledAt: receipt.settledAt, outcome: receipt.outcome },
    );
    return applied ?? receipt;
  }

  private accountingTask(runId: string, receipt: EffectReceipt): Promise<EffectReceipt> {
    const key = JSON.stringify([runId, receipt.effectId, receipt.outcome, receipt.settledAt]);
    const existing = this.accountingTasks.get(key);
    if (existing) return existing;
    const task = Promise.resolve()
      .then(() => this.applyAndMark(runId, receipt))
      .finally(() => {
        if (this.accountingTasks.get(key) === task) this.accountingTasks.delete(key);
      });
    this.accountingTasks.set(key, task);
    return task;
  }
}

async function waitForTasks(tasks: Promise<void>[], waitMs: number): Promise<void> {
  if (!tasks.length) return;
  if (waitMs <= 0) {
    await Promise.resolve();
    return;
  }
  await new Promise<void>((resolve) => {
    let remaining = tasks.length;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, waitMs);
    for (const task of tasks) {
      void task.then(() => {
        remaining -= 1;
        if (remaining === 0) finish();
      });
    }
  });
}
