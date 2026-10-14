import type {
  CommitEffectResult,
  ReserveEffectResult,
  SettleEffectResult,
} from '@lib/autopilot/RunCoordinator';
import type {
  LodestarMessage,
  EffectDescriptor,
  EffectExecutionToken,
  EffectOutcome,
} from '@lib/types';
import { isCommitResult, isReserveResult, isSettleResult } from './effectRuntimeValidation';

export interface EffectTransport {
  send(message: LodestarMessage): Promise<unknown>;
}

export interface EffectRuntimeClientDependencies extends EffectTransport {
  createId(): string;
  retries?: number;
}

export interface EffectCommitGate {
  commit(): Promise<boolean>;
  committed(): boolean;
}

export interface EffectExecutionObservation {
  outcome: EffectOutcome;
  reason?: string;
}

export type ReservedEffectToken = EffectExecutionToken;

export interface EffectExecutionResult extends EffectExecutionObservation {
  effectId?: string;
  requestId?: string;
  reserved: boolean;
  committed: boolean;
  settled?: boolean;
}

type EffectExecutor = (gate: EffectCommitGate) => Promise<EffectExecutionObservation>;

/** Content-side retry/idempotency boundary for the durable two-phase effect protocol. */
export class EffectRuntimeClient {
  private readonly retries: number;
  private readonly executions = new Map<string, Promise<EffectExecutionResult>>();

  constructor(private readonly dependencies: EffectRuntimeClientDependencies) {
    this.retries = Math.max(1, dependencies.retries ?? 3);
  }

  execute(
    runId: string,
    descriptor: EffectDescriptor,
    executor: EffectExecutor,
    requestId = this.dependencies.createId(),
  ): Promise<EffectExecutionResult> {
    const key = JSON.stringify([runId, requestId]);
    const existing = this.executions.get(key);
    if (existing) return existing;
    const task = this.reserveAndExecute(runId, requestId, descriptor, executor).finally(() => {
      if (this.executions.get(key) === task) this.executions.delete(key);
    });
    this.executions.set(key, task);
    return task;
  }

  executeReserved(
    token: ReservedEffectToken,
    executor: EffectExecutor,
  ): Promise<EffectExecutionResult> {
    const key = JSON.stringify([token.runId, token.requestId]);
    const existing = this.executions.get(key);
    if (existing) return existing;
    const task = this.runExecutor(token, executor).finally(() => {
      if (this.executions.get(key) === task) this.executions.delete(key);
    });
    this.executions.set(key, task);
    return task;
  }

  private async reserveAndExecute(
    runId: string,
    requestId: string,
    descriptor: EffectDescriptor,
    executor: EffectExecutor,
  ): Promise<EffectExecutionResult> {
    const result = await this.send<ReserveEffectResult>(
      {
        type: 'AUTOPILOT_RESERVE_EFFECT',
        runId,
        requestId,
        descriptor,
      },
      (value): value is ReserveEffectResult => isReserveResult(value, requestId, descriptor),
    );
    if (!result.canExecute) {
      const outcome =
        'receipt' in result && result.receipt
          ? result.receipt.outcome
          : result.kind === 'duplicate-request' || result.kind === 'duplicate-target'
            ? 'already'
            : result.kind === 'inactive'
              ? 'cancelled'
              : 'failed';
      return {
        outcome,
        reason: result.kind,
        ...('effectId' in result ? { effectId: result.effectId } : {}),
        requestId,
        reserved: false,
        committed: false,
        settled: Boolean('receipt' in result && result.receipt),
      };
    }
    return this.runExecutor({ runId, requestId, descriptor, effectId: result.effectId }, executor);
  }

  private async runExecutor(
    token: ReservedEffectToken,
    executor: EffectExecutor,
  ): Promise<EffectExecutionResult> {
    const attemptId = this.dependencies.createId();
    let committed = false;
    let commitTask: Promise<boolean> | undefined;
    const gate: EffectCommitGate = {
      committed: () => committed,
      commit: () => {
        if (commitTask) return commitTask;
        commitTask = this.send<CommitEffectResult>(
          {
            type: 'AUTOPILOT_COMMIT_EFFECT',
            runId: token.runId,
            effectId: token.effectId,
            requestId: token.requestId,
            attemptId,
          },
          (value): value is CommitEffectResult => isCommitResult(value, token, attemptId),
        ).then(
          (result) => {
            committed = result.admitted;
            return committed;
          },
          () => false,
        );
        return commitTask;
      },
    };

    let observation: EffectExecutionObservation;
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

    const settle = await this.send<SettleEffectResult>(
      {
        type: 'AUTOPILOT_SETTLE_EFFECT',
        runId: token.runId,
        effectId: token.effectId,
        requestId: token.requestId,
        ...(committed ? { attemptId } : {}),
        outcome: observation.outcome,
        ...(observation.reason ? { reason: observation.reason } : {}),
      },
      (value): value is SettleEffectResult =>
        isSettleResult(value, token, committed ? attemptId : undefined),
    ).catch(() => null);
    return {
      ...observation,
      effectId: token.effectId,
      requestId: token.requestId,
      reserved: true,
      committed,
      settled: settle !== null && settle.kind !== 'rejected',
    };
  }

  private async send<T>(message: LodestarMessage, valid: (value: unknown) => value is T): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.retries; attempt += 1) {
      try {
        const response = await this.dependencies.send(message);
        if (valid(response)) return response;
        lastError = new Error('invalid_effect_response');
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('effect_transport_failed');
  }
}
