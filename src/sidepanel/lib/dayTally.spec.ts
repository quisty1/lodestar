import { describe, expect, it } from 'vitest';
import type { AutopilotState, RunReport } from '@lib/types';
import { projectDayStats } from './dayTally';

const today = '2026-10-08';

function state(partial: Partial<AutopilotState>): AutopilotState {
  return {
    running: false,
    host: 'tab',
    day: today,
    ceiling: 30,
    used: 0,
    actionTimestamps: [],
    actionsSinceBreak: 0,
    manualStop: false,
    startedAt: `${today}T09:00:00.000Z`,
    ...partial,
  };
}

describe('projectDayStats', () => {
  it('keeps a confirmed like below the defensive budget when a like stayed uncertain', () => {
    const stats = projectDayStats({
      today,
      state: state({
        used: 2,
        runId: 'run-1',
        effectLedger: {
          version: 1,
          active: {},
          receipts: {
            a: {
              effectId: 'a',
              requestId: 'r1',
              descriptor: { kind: 'like', targetKey: 'p1' },
              reservedAt: `${today}T09:00:00.000Z`,
              settledAt: `${today}T09:01:00.000Z`,
              outcome: 'confirmed',
              accounting: 'applied',
            },
            b: {
              effectId: 'b',
              requestId: 'r2',
              descriptor: { kind: 'like', targetKey: 'p2' },
              reservedAt: `${today}T09:02:00.000Z`,
              settledAt: `${today}T09:03:00.000Z`,
              outcome: 'uncertain',
              accounting: 'applied',
            },
          },
        },
      }),
      reports: [],
      views: null,
      connects: null,
      ideas: null,
      comments: null,
      journal: [],
    });
    expect(stats.likes).toEqual({ confirmed: 1, budget: 2 });
  });

  it('adds earlier reports and does not count the live run twice', () => {
    const report: RunReport = {
      id: 'run-old',
      startedAt: `${today}T08:00:00.000Z`,
      endedAt: `${today}T08:10:00.000Z`,
      host: 'tab',
      stopReason: 'completed',
      modules: [{ id: 'profile_views', executed: 4, skipped: 0, failed: 0 }],
    };
    const live: RunReport = {
      ...report,
      id: 'run-1',
      modules: [{ id: 'profile_views', executed: 9, skipped: 0, failed: 0 }],
    };
    const stats = projectDayStats({
      today,
      state: state({
        runId: 'run-1',
        effectLedger: {
          version: 1,
          active: {},
          receipts: {
            v: {
              effectId: 'v',
              requestId: 'rv',
              descriptor: {
                kind: 'profile_view',
                targetKey: 'm',
                person: {
                  memberId: 'm',
                  name: 'A',
                  headline: '',
                  profileUrl: '/in/a',
                },
              },
              reservedAt: `${today}T10:00:00.000Z`,
              settledAt: `${today}T10:01:00.000Z`,
              outcome: 'confirmed',
              accounting: 'applied',
            },
          },
        },
      }),
      reports: [live, report],
      views: { day: today, used: 6 },
      connects: null,
      ideas: { day: today, used: 2 },
      comments: { day: today, used: 1 },
      journal: [
        {
          id: 'run-old:urn',
          text: 'q',
          author: 'a',
          postUrn: 'urn',
          at: `${today}T08:05:00.000Z`,
        },
      ],
    });
    expect(stats.views).toEqual({ confirmed: 5, budget: 6 });
    expect(stats.ideas).toEqual({ confirmed: 2, budget: 2 });
    expect(stats.comments).toEqual({ confirmed: 1, budget: 1 });
  });
});
