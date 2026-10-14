import { describe, it, expect } from 'vitest';
import { AutopilotGatekeeper, type GateState } from './AutopilotGatekeeper';
import { BurstGuard } from './BurstGuard';
import { RiskAssessor } from './RiskAssessor';

const MIN = 60_000;
const base = (over: Partial<GateState>): GateState => ({
  used: 0,
  ceiling: 40,
  manualStop: false,
  risk: [],
  actionTimestamps: [],
  now: 100 * MIN,
  ...over,
});

describe('AutopilotGatekeeper', () => {
  const gk = new AutopilotGatekeeper({
    burst: new BurstGuard({ maxActions: 5, windowMs: 3 * MIN }),
    risk: new RiskAssessor(),
  });

  it('acts when budget, burst and risk all allow', () => {
    expect(gk.decide(base({}))).toEqual({ action: 'act' });
  });

  it('stops manual with highest precedence (even if budget left)', () => {
    expect(gk.decide(base({ manualStop: true, risk: ['captcha'] }))).toEqual({
      action: 'stop',
      reason: 'manual',
    });
  });

  it('stops on risk before budget', () => {
    expect(gk.decide(base({ risk: ['http_429'], used: 100 }))).toEqual({
      action: 'stop',
      reason: 'risk',
    });
  });

  it('stops when the daily ceiling is reached', () => {
    expect(gk.decide(base({ used: 40, ceiling: 40 }))).toEqual({
      action: 'stop',
      reason: 'budget',
    });
  });

  it('waits when burst-limited but budget remains', () => {
    const now = 100 * MIN;
    const ts = [now - 2 * MIN, now - 90_000, now - 60_000, now - 30_000, now - 1000];
    const d = gk.decide(base({ actionTimestamps: ts, now }));
    expect(d).toEqual({ action: 'wait', waitMs: MIN });
  });
});
