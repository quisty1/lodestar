import { asArray } from '../engagement/settings';

export const CONNECT_HISTORY_KEY = 'connect:history';
export const CONNECT_HISTORY_EFFECT_IDS_KEY = 'connect:history:effect-ids';
export const CONNECT_SENT_KEY = 'connects:sent';

/** One sent connection request, with enough detail to show WHO was added and when. */
export interface ConnectRecord {
  memberId: string;
  name: string;
  headline: string;
  profileUrl: string;
  /** ISO timestamp the invite was sent. */
  sentAt: string;
  /** Ledger identity; absent on history written before ledger v1. */
  effectId?: string;
}

/**
 * Newest-first connect history, capped to the most recent `cap`. Tolerates a non-array
 * stored value (chrome.storage array-as-object gotcha) via asArray. Pure.
 */
export function appendConnectHistory(
  existing: unknown,
  records: ConnectRecord[],
  cap = 500,
): ConnectRecord[] {
  const current = asArray<ConnectRecord>(existing);
  const seen = new Set(current.flatMap((record) => (record.effectId ? [record.effectId] : [])));
  const fresh = records.filter((record) => {
    if (!record.effectId) return true;
    if (seen.has(record.effectId)) return false;
    seen.add(record.effectId);
    return true;
  });
  return [...fresh, ...current].slice(0, cap);
}
