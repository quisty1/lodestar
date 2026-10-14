/** Counter shape shared by persisted day/week safety budgets. */
export interface EffectCounter {
  used: number;
  /** Optional for counters written before effect-ledger v1. */
  effectIds?: string[];
}

const WEEK_PATTERN = /^(\d{4})-W(\d{2})$/;

/** Apply one effect exactly once without rolling a newer period backwards. */
export function recordEffectForPeriod<T extends EffectCounter>(
  current: T | null,
  currentPeriod: string | undefined,
  targetPeriod: string,
  fresh: () => T,
  effectId: string,
  count = 1,
): T {
  const safeCurrentPeriod = validPeriodLike(currentPeriod, targetPeriod);
  const normalizedCurrent = current ? normalizeCounter(current) : null;
  if (normalizedCurrent && safeCurrentPeriod && safeCurrentPeriod > targetPeriod)
    return normalizedCurrent;
  const base =
    normalizedCurrent && safeCurrentPeriod === targetPeriod
      ? normalizedCurrent
      : normalizeCounter(fresh());
  const effectIds = base.effectIds ?? [];
  if (effectIds.includes(effectId)) return base;
  const increment = Number.isFinite(count) ? Math.max(0, count) : 0;
  return { ...base, used: base.used + increment, effectIds: [...effectIds, effectId] };
}

function normalizeCounter<T extends EffectCounter>(counter: T): T {
  const used =
    typeof counter.used === 'number' && Number.isFinite(counter.used) && counter.used >= 0
      ? counter.used
      : 0;
  const rawEffectIds = counter.effectIds;
  const hasEffectIdsField = rawEffectIds !== undefined;
  const effectIds = Array.isArray(rawEffectIds)
    ? [
        ...new Set(
          rawEffectIds
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            .map((id) => id.trim()),
        ),
      ]
    : [];
  const idsUnchanged =
    !hasEffectIdsField ||
    (Array.isArray(rawEffectIds) &&
      rawEffectIds.length === effectIds.length &&
      rawEffectIds.every((id, index) => id === effectIds[index]));
  if (used === counter.used && idsUnchanged) return counter;
  return { ...counter, used, ...(hasEffectIdsField ? { effectIds } : {}) };
}

function validPeriodLike(value: string | undefined, target: string): string | undefined {
  if (!value) return undefined;
  if (WEEK_PATTERN.test(target)) {
    return validIsoWeek(value) ? value : undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function validIsoWeek(value: string): boolean {
  const match = value.match(WEEK_PATTERN);
  if (!match) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1) return false;
  const januaryFirst = new Date(`${match[1]}-01-01T00:00:00.000Z`).getUTCDay();
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const weeks = januaryFirst === 4 || (januaryFirst === 3 && leap) ? 53 : 52;
  return week <= weeks;
}
