import type { BurstGuard } from './BurstGuard';
import type { RiskAssessor, RiskMarker } from './RiskAssessor';

export interface GateState {
  used: number;
  ceiling: number;
  manualStop: boolean;
  risk: RiskMarker[];
  actionTimestamps: number[];
  now: number;
}

export type GateDecision =
  | { action: 'act' }
  | { action: 'wait'; waitMs: number }
  | { action: 'stop'; reason: 'budget' | 'risk' | 'manual' };

/**
 * The single autopilot decision point. Precedence:
 * manual > risk > budget, then burst (wait). Pure — the SW owns the persisted
 * state passed in and applies the decision.
 */
export class AutopilotGatekeeper {
  constructor(private readonly deps: { burst: BurstGuard; risk: RiskAssessor }) {}

  decide(state: GateState): GateDecision {
    if (state.manualStop) return { action: 'stop', reason: 'manual' };
    if (this.deps.risk.classify(state.risk) === 'stop') return { action: 'stop', reason: 'risk' };
    if (state.used >= state.ceiling) return { action: 'stop', reason: 'budget' };
    const burst = this.deps.burst.check(state.actionTimestamps, state.now);
    if (!burst.ok) return { action: 'wait', waitMs: burst.waitMs };
    return { action: 'act' };
  }
}
