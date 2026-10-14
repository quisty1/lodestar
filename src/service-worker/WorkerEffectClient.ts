import type {
  CommitEffectResult,
  ReserveEffectResult,
  SettleEffectOptions,
  SettleEffectResult,
} from '@lib/autopilot/RunCoordinator';
import type { EffectDescriptor, EffectExecutionToken, EffectOutcome } from '@lib/types';

export interface WorkerEffectCoordinator {
  reserveEffect(
    runId: string,
    requestId: string,
    descriptor: EffectDescriptor,
  ): Promise<ReserveEffectResult>;
  commitEffect(
    runId: string,
    effectId: string,
    requestId: string,
    attemptId: string,
  ): Promise<CommitEffectResult>;
}

export interface WorkerEffectService {
  settle(
    runId: string,
    effectId: string,
    requestId: string,
    outcome: EffectOutcome,
    options?: SettleEffectOptions,
  ): Promise<SettleEffectResult>;
}

export interface WorkerEffectObservation {
  outcome: EffectOutcome;
  reason?: string;
  reserved?: boolean;
  committed?: boolean;
  settled?: boolean;
}

export type WorkerReservation =
  | { kind: 'ready'; token: EffectExecutionToken }
  | { kind: 'blocked'; outcome: EffectOutcome; reason: string };

export interface WorkerCommitGate {
  commit(): Promise<boolean>;
  committed(): boolean;
}

export class WorkerEffectClient {
  private readonly executions = new Map<string, Promise<WorkerEffectObservation>>();

  constructor(
    private readonly dependencies: {
      coordinator: WorkerEffectCoordinator;
      effects: WorkerEffectService;
      createId(): string;
    },
  ) {}

  async reserve(
    runId: string,
    requestId: string,
    descriptor: EffectDescriptor,
  ): Promise<WorkerReservation> {
    const result = await this.dependencies.coordinator.reserveEffect(runId, requestId, descriptor);
    if (result.canExecute) {
      return {
        kind: 'ready',
        token: { runId, requestId, effectId: result.effectId, descriptor: result.lease.descriptor },
      };
    }
    if ('receipt' in result && result.receipt) {
      return { kind: 'blocked', outcome: result.receipt.outcome, reason: result.kind };
    }
    if (result.kind === 'duplicate-request' || result.kind === 'duplicate-target') {
      return { kind: 'blocked', outcome: 'already', reason: result.kind };
    }
    return {
      kind: 'blocked',
      outcome: result.kind === 'inactive' ? 'cancelled' : 'failed',
      reason: result.kind,
    };
  }

  execute(
    runId: string,
    requestId: string,
    descriptor: EffectDescriptor,
    executor: (gate: WorkerCommitGate) => Promise<WorkerEffectObservation>,
  ): Promise<WorkerEffectObservation> {
    const key = JSON.stringify([runId, requestId]);
    const existing = this.executions.get(key);
    if (existing) return existing;
    const task = this.reserve(runId, requestId, descriptor)
      .then((reservation) =>
        reservation.kind === 'ready' ? this.runReserved(reservation.token, executor) : reservation,
      )
      .then((result) => ({
        outcome: result.outcome,
        reason: result.reason,
        ...('reserved' in result ? { reserved: result.reserved } : {}),
        ...('committed' in result ? { committed: result.committed } : {}),
        ...('settled' in result ? { settled: result.settled } : {}),
      }))
      .finally(() => {
        if (this.executions.get(key) === task) this.executions.delete(key);
      });
    this.executions.set(key, task);
    return task;
  }

  private async runReserved(
    token: EffectExecutionToken,
    executor: (gate: WorkerCommitGate) => Promise<WorkerEffectObservation>,
  ): Promise<WorkerEffectObservation> {
    const attemptId = this.dependencies.createId();
    let committed = false;
    let commitTask: Promise<boolean> | undefined;
    const gate: WorkerCommitGate = {
      committed: () => committed,
      commit: () => {
        if (commitTask) return commitTask;
        commitTask = this.dependencies.coordinator
          .commitEffect(token.runId, token.effectId, token.requestId, attemptId)
          .then(
            (result) => {
              committed = result.admitted;
              return committed;
            },
            () => false,
          );
        return commitTask;
      },
    };

    let observation: WorkerEffectObservation;
    try {
      observation = await executor(gate);
    } catch (error) {
      observation = {
        outcome: committed ? 'uncertain' : 'failed',
        reason: error instanceof Error ? error.message : 'executor_failed',
      };
    }
    if (
      (observation.outcome === 'confirmed' || observation.outcome === 'uncertain') &&
      !committed
    ) {
      observation = { outcome: 'failed', reason: observation.reason ?? 'commit_rejected' };
    }
    const settlement = await this.dependencies.effects
      .settle(token.runId, token.effectId, token.requestId, observation.outcome, {
        attemptId: committed ? attemptId : undefined,
        reason: observation.reason,
      })
      .catch(() => null);
    return {
      ...observation,
      reserved: true,
      committed,
      settled: settlement !== null && settlement.kind !== 'rejected',
    };
  }
}
