import type { ModuleId, SsiPillar, SsiPillarKey } from '../types';

export interface WeeklyGoal {
  pillarKey: SsiPillarKey;
  pillarLabel: string;
  /** Current pillar score (0..25). */
  score: number;
  /** A reachable next milestone (score + 3, capped at 25). */
  target: number;
  /** The lever module that raises this pillar. */
  module: ModuleId;
  /** One-line human-readable suggestion. */
  message: string;
  /** False when the lever module is switched off. */
  leverEnabled: boolean;
}

/** Which Lodestar module raises each SSI pillar (the lever map). */
export const PILLAR_LEVER: Record<SsiPillarKey, { module: ModuleId; how: string }> = {
  insights: {
    module: 'engagement',
    how: 'усилит вовлечённость — умные лайки и комментарии в ленте',
  },
  brand: { module: 'content', how: 'поднимет бренд — посты из идей твоей ленты' },
  people: { module: 'profile_views', how: 'найдёт нужных людей — заходит на профили целевой ЦА' },
  relationships: { module: 'smart_connect', how: 'построит связи — коннекты рекрутёрам и ЦА' },
};

/**
 * The week's focus: the WEAKEST SSI pillar + the module that raises it. Pure,
 * deterministic — no LLM needed (the pillar→lever mapping is fixed). Operationalises
 * the north-star: lift each pillar by pointing the user at the right lever.
 */
export function weeklyGoal(
  pillars: SsiPillar[],
  enabledModuleIds?: readonly ModuleId[],
): WeeklyGoal | null {
  if (!pillars.length) return null;
  const weakest = pillars.reduce((min, p) => (p.score < min.score ? p : min));
  const lever = PILLAR_LEVER[weakest.key];
  const target = Math.min(25, weakest.score + 3);
  const leverEnabled = enabledModuleIds ? enabledModuleIds.includes(lever.module) : true;
  const message = leverEnabled
    ? `Слабее всего «${weakest.label}» (${weakest.score}/25). Lodestar ${lever.how}.`
    : `Слабее всего «${weakest.label}» (${weakest.score}/25). Модуль выключен — включи его, иначе балл не сдвинется.`;
  return {
    pillarKey: weakest.key,
    pillarLabel: weakest.label,
    score: weakest.score,
    target,
    module: lever.module,
    message,
    leverEnabled,
  };
}
