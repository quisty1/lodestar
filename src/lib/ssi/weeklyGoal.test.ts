import { describe, it, expect } from 'vitest';
import { weeklyGoal, PILLAR_LEVER } from './weeklyGoal';
import type { SsiPillar } from '../types';

const pillars = (scores: Partial<Record<SsiPillar['key'], number>>): SsiPillar[] => [
  { key: 'brand', label: 'Профессиональный бренд', score: scores.brand ?? 20 },
  { key: 'people', label: 'Поиск нужных людей', score: scores.people ?? 20 },
  { key: 'insights', label: 'Обмен инсайтами', score: scores.insights ?? 20 },
  { key: 'relationships', label: 'Построение связей', score: scores.relationships ?? 20 },
];

describe('weeklyGoal', () => {
  it('targets the weakest pillar and maps it to the right lever module', () => {
    const g = weeklyGoal(pillars({ relationships: 12 }))!;
    expect(g.pillarKey).toBe('relationships');
    expect(g.score).toBe(12);
    expect(g.module).toBe('smart_connect');
  });

  it('maps insights → engagement, brand → content, people → profile_views', () => {
    expect(weeklyGoal(pillars({ insights: 9 }))!.module).toBe('engagement');
    expect(weeklyGoal(pillars({ brand: 8 }))!.module).toBe('content');
    expect(weeklyGoal(pillars({ people: 10 }))!.module).toBe('profile_views');
  });

  it('proposes a reachable next milestone (capped at 25)', () => {
    expect(weeklyGoal(pillars({ insights: 12 }))!.target).toBe(15); // +3
    // all high → weakest is 24 → +3 capped at 25
    expect(
      weeklyGoal(pillars({ brand: 24, people: 24, insights: 24, relationships: 24 }))!.target,
    ).toBe(25);
  });

  it('returns null when there are no pillars', () => {
    expect(weeklyGoal([])).toBeNull();
  });

  it('maps People pillar to the profile_views lever (research: views, not connects)', () => {
    const pillars = [
      { key: 'people', label: 'Нужные люди', score: 10 },
      { key: 'brand', label: 'Бренд', score: 20 },
      { key: 'insights', label: 'Инсайты', score: 20 },
      { key: 'relationships', label: 'Связи', score: 20 },
    ] as const;
    const goal = weeklyGoal([...pillars])!;
    expect(goal.module).toBe('profile_views');
  });

  it('relationships lever no longer claims a personal Note (bare invites ship)', () => {
    expect(PILLAR_LEVER.relationships.how).not.toMatch(/Note/i);
  });

  it('says the lever is off when that module is disabled', () => {
    const goal = weeklyGoal(pillars({ brand: 8 }), ['engagement'])!;
    expect(goal.module).toBe('content');
    expect(goal.leverEnabled).toBe(false);
    expect(goal.message).toMatch(/выключен/);
  });
});
