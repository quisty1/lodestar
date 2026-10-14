import type { SsiPillar, SsiPillarKey } from '../types';
import { PILLARS } from '../ssi/pillars';
import { clampPillar } from '../ssi/parse-helpers';
import {
  SsiApiError,
  type ApiGroupType,
  type ApiPillar,
  type RawSnapshot,
  type SsiApiResponse,
} from './contracts';

/** API pillar enum → our canonical domain key. */
const PILLAR_KEY: Record<ApiPillar, SsiPillarKey> = {
  PROFESSIONAL_BRAND: 'brand',
  FIND_RIGHT_PEOPLE: 'people',
  INSIGHT_ENGAGEMENT: 'insights',
  STRONG_RELATIONSHIP: 'relationships',
};

const LABEL: Record<SsiPillarKey, string> = Object.fromEntries(
  PILLARS.map((p) => [p.key, p.label]),
) as Record<SsiPillarKey, string>;

/**
 * Pure mapper: `/sales-api/salesApiSsi` JSON → domain RawSnapshot. No I/O.
 *
 * Mirrors the DOM parser's output exactly so the two sources are
 * interchangeable: total rounded (the gauge shows an integer), precise pillar
 * scores preserved, ranks rendered as "Top N%".
 */
export function mapApiResponse(res: SsiApiResponse): RawSnapshot {
  const member = res?.memberScore;
  if (!member || !Array.isArray(member.subScores)) {
    throw new SsiApiError('SSI response missing memberScore.subScores');
  }

  const scoreByApiPillar = new Map<ApiPillar, number>(
    member.subScores.map((s) => [s.pillar, s.score]),
  );

  // Build pillars in canonical PILLARS order (not the API's arrival order).
  const pillars: SsiPillar[] = PILLARS.map((def) => {
    const apiPillar = (Object.keys(PILLAR_KEY) as ApiPillar[]).find(
      (ap) => PILLAR_KEY[ap] === def.key,
    );
    const score = apiPillar === undefined ? undefined : scoreByApiPillar.get(apiPillar);
    if (apiPillar === undefined || score === undefined) {
      throw new SsiApiError(`SSI response missing pillar ${def.key}`);
    }
    return {
      key: def.key,
      label: LABEL[def.key],
      score: clampPillar(score),
    };
  });

  const total = Math.round(member.overall);

  return {
    total,
    pillars,
    ...rank(res, 'INDUSTRY', 'industryRank'),
    ...rank(res, 'NETWORK', 'networkRank'),
  };
}

function rank(
  res: SsiApiResponse,
  groupType: ApiGroupType,
  field: 'industryRank' | 'networkRank',
): Partial<Pick<RawSnapshot, 'industryRank' | 'networkRank'>> {
  const group = res.groupScore?.find((g) => g.groupType === groupType);
  if (!group || typeof group.rank !== 'number') return {};
  return { [field]: `Top ${group.rank}%` };
}
