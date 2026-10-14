import type {
  AutopilotState,
  AutopilotStatus,
  EffectDescriptor,
  EffectOutcome,
  EffectReceipt,
  ModuleId,
  ModuleOutcome,
  RunPhase,
  RunReport,
  StopReason,
} from '../types';
import type { RiskMarker } from './RiskAssessor';
import {
  pendingFromState,
  transitionExpire,
  transitionReconcile,
  transitionSettle,
} from './effectSettlement';
import { transitionCommit, transitionMarkAccounted, transitionReserve } from './effectReserve';
import { decideBegin, decideFinalize, decideRecover, decideStop } from './runLifecycleTransitions';
import {
  AUTOPILOT_STATE_KEY,
  type BeginRunInput,
  type BeginRunResult,
  type CommitEffectResult,
  type PendingEffects,
  type PhaseDetails,
  type ReconcileEffectsResult,
  type ReserveEffectResult,
  type RunCoordinatorDependencies,
  type RunTargetDetails,
  type SettleEffectOptions,
  type SettleEffectResult,
} from './runCoordinator.types';
import {
  isActiveRun,
  isMutableActiveState,
  reportFromState,
  revisionOf,
  statusFromState,
  terminalPhase,
} from './runStateProjection';

export { AUTOPILOT_STATE_KEY } from './runCoordinator.types';
export type {
  BeginRunInput,
  BeginRunResult,
  CommitEffectResult,
  PendingEffects,
  PhaseDetails,
  ReconcileEffectsResult,
  ReserveEffectResult,
  RunCoordinatorDependencies,
  RunTargetDetails,
  SettleEffectOptions,
  SettleEffectResult,
} from './runCoordinator.types';
export { isScopedAutopilotState } from './runStateProjection';

/**
 * Owns all persisted run mutations. The promise tail is the lock: late/stale
 * messages are checked only after every earlier stop/finalize write has landed.
 */
export class RunCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private notificationTail: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: RunCoordinatorDependencies) {}

  begin(input: BeginRunInput): Promise<BeginRunResult> {
    return this.serialize(async () => {
      const outcome = decideBegin(
        await this.read(),
        input,
        () => this.now(),
        () => this.dependencies.createId(),
      );
      if (outcome.next) await this.write(outcome.next);
      return outcome.result;
    });
  }

  async getState(): Promise<AutopilotState | null> {
    await this.tail;
    return this.read();
  }

  async status(): Promise<AutopilotStatus> {
    await this.tail;
    return statusFromState(await this.read());
  }

  async isActive(runId?: string): Promise<boolean> {
    await this.tail;
    return isActiveRun(await this.read(), runId);
  }

  setPhase(
    runId: string,
    phase: RunPhase,
    details: PhaseDetails = {},
  ): Promise<AutopilotState | null> {
    if (terminalPhase(phase)) return Promise.resolve(null);
    return this.mutateActive(runId, (state) => ({ ...state, phase, ...details }));
  }

  setStage(runId: string, stage: string, expectedUrl?: string): Promise<AutopilotState | null> {
    return this.mutateActive(runId, (state) => ({
      ...state,
      stage,
      expectedUrl: expectedUrl ?? state.expectedUrl,
    }));
  }

  setTarget(runId: string, target: RunTargetDetails): Promise<AutopilotState | null> {
    return this.mutateActive(runId, (state) => ({ ...state, ...target }));
  }

  recordActed(runId: string, count = 1): Promise<AutopilotState | null> {
    const increment = Number.isFinite(count) ? Math.max(0, count) : 0;
    return this.mutateActive(runId, (state) => ({
      ...state,
      used: state.used + increment,
      actionTimestamps: [
        ...state.actionTimestamps,
        ...Array.from({ length: increment }, () => this.dependencies.clock.now().getTime()),
      ].slice(-20),
    }));
  }

  recordRisk(runId: string, marker: RiskMarker): Promise<AutopilotState | null> {
    return this.mutateActive(runId, (state) => ({
      ...state,
      riskMarkers: [...(state.riskMarkers ?? []), marker],
    }));
  }

  recordOutcome(
    runId: string,
    moduleId: ModuleId,
    outcome: ModuleOutcome,
  ): Promise<AutopilotState | null> {
    return this.mutateActive(runId, (state) => ({
      ...state,
      moduleOutcomes: { ...(state.moduleOutcomes ?? {}), [moduleId]: { ...outcome } },
    }));
  }

  reserveEffect(
    runId: string,
    requestId: string,
    descriptor: EffectDescriptor,
  ): Promise<ReserveEffectResult> {
    return this.apply((state) =>
      transitionReserve(
        state,
        runId,
        requestId,
        descriptor,
        () => this.now(),
        () => this.dependencies.createId(),
      ),
    );
  }

  commitEffect(
    runId: string,
    effectId: string,
    requestId: string,
    attemptId: string,
  ): Promise<CommitEffectResult> {
    return this.apply((state) =>
      transitionCommit(state, runId, effectId, requestId, attemptId, () => this.now()),
    );
  }

  settleEffect(
    runId: string,
    effectId: string,
    requestId: string,
    outcome: EffectOutcome,
    options: SettleEffectOptions = {},
  ): Promise<SettleEffectResult> {
    return this.apply((state) =>
      transitionSettle(
        state,
        runId,
        effectId,
        requestId,
        outcome,
        options,
        () => this.now(),
        () => this.dependencies.clock.now().getTime(),
      ),
    );
  }

  markEffectAccounted(
    runId: string,
    effectId: string,
    expected: Pick<EffectReceipt, 'settledAt' | 'outcome'>,
  ): Promise<EffectReceipt | null> {
    return this.apply((state) =>
      transitionMarkAccounted(state, runId, effectId, expected, () => this.now()),
    );
  }

  async pendingEffects(runId: string): Promise<PendingEffects | null> {
    await this.tail;
    return pendingFromState(await this.read(), runId);
  }

  expireCommittedEffects(
    runId: string,
    committedBefore?: string,
    forceEffectIds: readonly string[] = [],
  ): Promise<EffectReceipt[]> {
    return this.apply((state) =>
      transitionExpire(
        state,
        runId,
        committedBefore,
        forceEffectIds,
        () => this.now(),
        () => this.dependencies.clock.now().getTime(),
      ),
    );
  }

  reconcileEffects(
    runId: string,
    options: { expireCommittedBefore?: string } = {},
  ): Promise<ReconcileEffectsResult> {
    return this.apply((state) =>
      transitionReconcile(
        state,
        runId,
        options,
        () => this.now(),
        () => this.dependencies.clock.now().getTime(),
      ),
    );
  }

  requestStop(runId: string, reason: StopReason): Promise<AutopilotState | null> {
    return this.apply((state) => decideStop(state, runId, reason, () => this.now()));
  }

  finalize(runId: string, reason?: StopReason): Promise<RunReport | null> {
    return this.serialize(async () => {
      const decision = decideFinalize(await this.read(), runId, reason, () => this.now());
      if (decision.kind === 'missing') return null;
      if (decision.kind === 'existing') return this.findReport(runId);
      return this.finalizeState(decision.state, decision.stopReason);
    });
  }

  /**
   * Archives a stale persisted run without ever touching a healthy scoped run.
   * Legacy snapshots receive a stable synthetic run id before report persistence,
   * so a crash/retry can resume exact-once finalization.
   */
  recoverInterrupted(): Promise<RunReport | null> {
    return this.serialize(async () => {
      const decision = decideRecover(
        await this.read(),
        () => this.now(),
        () => this.dependencies.createId(),
      );
      if (decision.kind === 'none') return null;
      if (decision.kind === 'finished') {
        if (decision.clearRunning) await this.write(decision.clearRunning);
        return this.findReport(decision.runId);
      }
      return this.finalizeState(decision.state, decision.stopReason);
    });
  }

  private async finalizeState(
    state: Parameters<typeof reportFromState>[0] & {
      phase: RunPhase;
      startRequestId: string;
      riskMarkers: RiskMarker[];
      updatedAt: string;
    },
    stopReason: StopReason,
  ): Promise<RunReport> {
    const now = this.now();
    const finalizing = {
      ...state,
      running: false,
      phase: 'finalizing' as const,
      stopReason,
      endedAt: state.endedAt ?? now,
      updatedAt: now,
    };
    await this.write(finalizing);
    const report = reportFromState(finalizing);
    const added = await this.dependencies.reports.addOnce(report);
    const result = added ? report : ((await this.findReport(state.runId)) ?? report);
    const finished: AutopilotState = { ...finalizing, phase: 'finished', updatedAt: this.now() };
    await this.write(finished);
    return result;
  }

  private mutateActive(
    runId: string,
    mutation: (state: AutopilotState) => AutopilotState,
  ): Promise<AutopilotState | null> {
    return this.serialize(async () => {
      const state = await this.read();
      if (!isMutableActiveState(state) || state.runId !== runId) return null;
      const next = { ...mutation(state), updatedAt: this.now() };
      await this.write(next);
      return next;
    });
  }

  private apply<T>(
    transition: (state: AutopilotState | null) => { result: T; next?: AutopilotState },
  ): Promise<T> {
    return this.serialize(async () => {
      const outcome = transition(await this.read());
      if (outcome.next) await this.write(outcome.next);
      return outcome.result;
    });
  }

  private async findReport(runId: string): Promise<RunReport | null> {
    return (await this.dependencies.reports.list()).find((report) => report.id === runId) ?? null;
  }

  private read(): Promise<AutopilotState | null> {
    return this.dependencies.store.get<AutopilotState>(AUTOPILOT_STATE_KEY);
  }

  private async write(state: AutopilotState): Promise<void> {
    const previous = await this.read();
    state.revision = Math.max(revisionOf(previous?.revision), revisionOf(state.revision)) + 1;
    await this.dependencies.store.set(AUTOPILOT_STATE_KEY, state);
    this.enqueueNotification(statusFromState(state));
  }

  private enqueueNotification(status: AutopilotStatus): void {
    const broadcast = this.dependencies.broadcast;
    if (!broadcast) return;
    this.notificationTail = this.notificationTail.then(async () => {
      try {
        await broadcast(status);
      } catch {
        // Panel delivery is best-effort; persisted state remains the source of truth.
      }
    });
  }

  private now(): string {
    return this.dependencies.clock.now().toISOString();
  }

  private serialize<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(mutation, mutation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
