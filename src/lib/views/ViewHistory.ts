import { asArray } from '../engagement/settings';

export const VIEW_HISTORY_KEY = 'views:history';
export const VIEW_HISTORY_EFFECT_IDS_KEY = 'views:history:effect-ids';

/** One viewed profile, with enough detail to show WHO was visited and when. */
export interface ViewRecord {
  memberId: string;
  name: string;
  headline: string;
  profileUrl: string;
  /** ISO timestamp the profile was visited. */
  viewedAt: string;
  /** Ledger identity; absent on history written before ledger v1. */
  effectId?: string;
}

/** Newest-first view history, capped. Tolerates a non-array stored value (storage gotcha). Pure. */
export function appendViewHistory(
  existing: unknown,
  records: ViewRecord[],
  cap = 500,
): ViewRecord[] {
  const current = asArray<ViewRecord>(existing);
  const seen = new Set(current.flatMap((record) => (record.effectId ? [record.effectId] : [])));
  const fresh = records.filter((record) => {
    if (!record.effectId) return true;
    if (seen.has(record.effectId)) return false;
    seen.add(record.effectId);
    return true;
  });
  return [...fresh, ...current].slice(0, cap);
}
