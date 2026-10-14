import { describe, it, expect } from 'vitest';
import { enabledModules, decideAutopilotStart, runLoopModules } from './startGate';
import type { ModuleState, AutopilotState } from '../types';

const mod = (over: Partial<ModuleState> = {}): ModuleState => ({
  id: 'engagement',
  enabled: true,
  automationLevel: 'manual',
  available: true,
  dailyLimit: 35,
  ...over,
});

const running = (over: Partial<AutopilotState> = {}): AutopilotState => ({
  running: true,
  host: 'tab',
  day: '2026-06-25',
  ceiling: 35,
  used: 0,
  actionTimestamps: [],
  actionsSinceBreak: 0,
  manualStop: false,
  startedAt: '',
  ...over,
});

describe('enabledModules', () => {
  it('keeps a module that is enabled AND available', () => {
    expect(enabledModules([mod()]).map((m) => m.id)).toEqual(['engagement']);
  });

  it('drops a disabled module', () => {
    expect(enabledModules([mod({ enabled: false })])).toEqual([]);
  });

  it('drops an enabled-but-unavailable («Скоро») module', () => {
    expect(enabledModules([mod({ id: 'content', available: false })])).toEqual([]);
  });

  it('guards the chrome.storage array-as-object shape', () => {
    expect(enabledModules({ 0: mod() }).map((m) => m.id)).toEqual(['engagement']);
  });

  it('returns [] for null / empty', () => {
    expect(enabledModules(null)).toEqual([]);
    expect(enabledModules([])).toEqual([]);
  });
});

describe('decideAutopilotStart', () => {
  it('blocks the start with reason "no-modules" when nothing is enabled', () => {
    expect(decideAutopilotStart([mod({ enabled: false })], null)).toEqual({
      started: false,
      reason: 'no-modules',
    });
  });

  it('starts when an enabled+available module exists', () => {
    expect(decideAutopilotStart([mod()], null)).toEqual({ started: true });
  });

  it('reports started when already running, regardless of modules (idempotent)', () => {
    expect(decideAutopilotStart([], running())).toEqual({ started: true });
  });
});

describe('runLoopModules', () => {
  it('flags engagement and content independently from enabled+available', () => {
    expect(runLoopModules([mod(), mod({ id: 'content' })])).toEqual({
      engagement: true,
      content: true,
    });
  });
  it('excludes a disabled or unavailable module', () => {
    expect(runLoopModules([mod(), mod({ id: 'content', available: false })])).toEqual({
      engagement: true,
      content: false,
    });
    expect(runLoopModules([mod({ enabled: false })])).toEqual({
      engagement: false,
      content: false,
    });
  });
});
