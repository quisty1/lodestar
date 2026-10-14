import type { Clock, KeyValueStore } from '../ports';
import type {
  AutopilotHost,
  AutopilotState,
  AutopilotStatus,
  EffectLease,
  EffectOutcome,
  EffectReceipt,
} from '../types';
import type { EffectLedgerError } from './EffectLedger';
import type { RunReportStore } from './RunReportStore';

export const AUTOPILOT_STATE_KEY = 'autopilot:state';

export interface BeginRunInput {
  requestId: string;
  host: AutopilotHost;
  day: string;
  ceiling: number;
  used: number;
  windowId?: number;
  tabId?: number;
  expectedUrl?: string;
}

export type BeginRunResult =
  | { kind: 'started'; runId: string; state: AutopilotState }
  | { kind: 'duplicate'; runId: string; state: AutopilotState }
  | { kind: 'already-running'; runId: string; state: AutopilotState }
  | { kind: 'recovery-required'; runId?: string; state: AutopilotState };

export interface PhaseDetails {
  stage?: string;
  expectedUrl?: string;
}

export interface RunTargetDetails {
  tabId: number;
  windowId?: number;
  expectedUrl: string;
}

export interface RunCoordinatorDependencies {
  store: KeyValueStore;
  clock: Clock;
  reports: RunReportStore;
  createId: () => string;
  broadcast?: (status: AutopilotStatus) => void | Promise<void>;
}

export type ReserveEffectResult =
  | { kind: 'reserved' | 'resumed'; canExecute: true; effectId: string; lease: EffectLease }
  | {
      kind: 'duplicate-request' | 'duplicate-target';
      canExecute: false;
      effectId: string;
      lease?: EffectLease;
      receipt?: EffectReceipt;
    }
  | {
      kind: 'identity';
      canExecute: false;
      effectId: string;
      lease?: EffectLease;
      receipt?: EffectReceipt;
    }
  | { kind: 'ledger-error'; canExecute: false; error: EffectLedgerError }
  | { kind: 'inactive' | 'invalid'; canExecute: false; effectId?: undefined };

export type CommitEffectResult =
  | { kind: 'committed' | 'already-committed'; admitted: true; lease: EffectLease }
  | {
      kind: 'rejected';
      admitted: false;
      reason: 'inactive' | 'not-found' | 'identity' | 'attempt' | 'settled' | 'ledger-error';
      error?: EffectLedgerError;
    };

export type SettleEffectResult =
  | { kind: 'settled' | 'duplicate' | 'upgraded'; receipt: EffectReceipt }
  | {
      kind: 'rejected';
      reason:
        | 'inactive'
        | 'invalid'
        | 'not-found'
        | 'identity'
        | 'attempt'
        | 'not-committed'
        | 'finished'
        | 'ledger-error';
      error?: EffectLedgerError;
    };

export interface SettleEffectOptions {
  attemptId?: string;
  reason?: string;
}

export interface PendingEffects {
  committed: EffectLease[];
  accounting: EffectReceipt[];
  blocked?: EffectLedgerError;
}

export interface ReconcileEffectsResult {
  cancelled: EffectReceipt[];
  expired: EffectReceipt[];
  blocked?: EffectLedgerError;
}

export interface TransitionIo {
  now(): string;
  nowMs(): number;
  createId(): string;
}

export type { EffectOutcome };
