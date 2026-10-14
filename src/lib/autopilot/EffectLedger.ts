import { EFFECT_KINDS } from '../types';
import type {
  EffectDescriptor,
  EffectLease,
  EffectLedgerV1,
  EffectOutcome,
  EffectPerson,
  EffectReceipt,
} from '../types';

const KIND_SET = new Set<string>(EFFECT_KINDS);
const OUTCOME_SET = new Set<EffectOutcome>([
  'confirmed',
  'already',
  'failed',
  'cancelled',
  'uncertain',
]);
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const UNSAFE_EFFECT_IDS = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);

export type EffectLedgerError = 'unsupported-version' | 'malformed-v1';

export type EffectLedgerClassification =
  | { kind: 'missing' }
  | { kind: 'valid'; ledger: EffectLedgerV1 }
  | { kind: 'invalid'; error: EffectLedgerError; source: unknown };

export function emptyEffectLedger(): EffectLedgerV1 {
  return { version: 1, active: {}, receipts: {} };
}

/** Runtime boundary for persisted data. Invalid/future values are never rewritten. */
export function classifyEffectLedger(value: unknown): EffectLedgerClassification {
  if (value === undefined) return { kind: 'missing' };
  if (!isRecord(value)) return { kind: 'invalid', error: 'malformed-v1', source: value };
  if (value.version !== 1) return { kind: 'invalid', error: 'unsupported-version', source: value };
  if (!isRecord(value.active) || !isRecord(value.receipts)) {
    return { kind: 'invalid', error: 'malformed-v1', source: value };
  }

  const active: Record<string, EffectLease> = {};
  const receipts: Record<string, EffectReceipt> = {};
  for (const [key, raw] of Object.entries(value.active)) {
    if (isRemovedWithdrawEntry(raw)) continue;
    if (sanitizeEffectId(key) !== key)
      return { kind: 'invalid', error: 'malformed-v1', source: value };
    const lease = normalizeLease(raw);
    if (!lease || lease.effectId !== key)
      return { kind: 'invalid', error: 'malformed-v1', source: value };
    active[key] = lease;
  }
  for (const [key, raw] of Object.entries(value.receipts)) {
    if (isRemovedWithdrawEntry(raw)) continue;
    if (sanitizeEffectId(key) !== key)
      return { kind: 'invalid', error: 'malformed-v1', source: value };
    const receipt = normalizeReceipt(raw);
    if (!receipt || receipt.effectId !== key || active[key]) {
      return { kind: 'invalid', error: 'malformed-v1', source: value };
    }
    receipts[key] = receipt;
  }

  const identities = [...Object.values(active), ...Object.values(receipts)];
  const requests = new Set<string>();
  const targets = new Set<string>();
  for (const effect of identities) {
    const target = `${effect.descriptor.kind}\u0000${effect.descriptor.targetKey}`;
    if (requests.has(effect.requestId) || targets.has(target)) {
      return { kind: 'invalid', error: 'malformed-v1', source: value };
    }
    requests.add(effect.requestId);
    targets.add(target);
  }
  return { kind: 'valid', ledger: { version: 1, active, receipts } };
}

export function hasEffectLedger(value: unknown): value is EffectLedgerV1 {
  return classifyEffectLedger(value).kind === 'valid';
}

/** Missing is the only legacy shape that can safely become an empty v1 ledger. */
export function normalizeEffectLedger(value: unknown): EffectLedgerV1 {
  const classified = classifyEffectLedger(value);
  if (classified.kind === 'missing') return emptyEffectLedger();
  if (classified.kind === 'valid') return classified.ledger;
  throw new EffectLedgerStateError(classified.error);
}

export class EffectLedgerStateError extends Error {
  constructor(readonly code: EffectLedgerError) {
    super(`effect_ledger_${code}`);
    this.name = 'EffectLedgerStateError';
  }
}

/** Keeps only identifier fields approved for durable persistence. */
export function sanitizeEffectDescriptor(value: unknown): EffectDescriptor | null {
  if (!isRecord(value) || !KIND_SET.has(String(value.kind))) return null;
  const targetKey = nonEmpty(value.targetKey);
  if (!targetKey) return null;

  switch (value.kind) {
    case 'like':
    case 'comment': {
      const postUrn = nonEmpty(value.postUrn);
      return postUrn ? { kind: value.kind, targetKey, postUrn } : { kind: value.kind, targetKey };
    }
    case 'connect':
    case 'profile_view': {
      const person = sanitizePerson(value.person);
      return person ? { kind: value.kind, targetKey, person } : null;
    }
    case 'publish': {
      const draftId = nonEmpty(value.draftId);
      return draftId ? { kind: 'publish', targetKey, draftId } : null;
    }
    default:
      return null;
  }
}

export function sanitizeEffectId(value: unknown): string | null {
  const effectId = nonEmpty(value);
  return effectId && !UNSAFE_EFFECT_IDS.has(effectId) ? effectId : null;
}

export function isEffectOutcome(value: unknown): value is EffectOutcome {
  return typeof value === 'string' && OUTCOME_SET.has(value as EffectOutcome);
}

function normalizeLease(value: unknown): EffectLease | null {
  if (!isRecord(value)) return null;
  const effectId = sanitizeEffectId(value.effectId);
  const requestId = nonEmpty(value.requestId);
  const descriptor = sanitizeEffectDescriptor(value.descriptor);
  const reservedAt = isoTimestamp(value.reservedAt);
  const stage = value.stage === 'reserved' || value.stage === 'committed' ? value.stage : null;
  if (!effectId || !requestId || !descriptor || !reservedAt || !stage) return null;
  if (stage === 'reserved') {
    if (value.committedAt !== undefined || value.commitAttemptId !== undefined) return null;
    return { effectId, requestId, descriptor, stage, reservedAt };
  }

  const committedAt = isoTimestamp(value.committedAt);
  if (!committedAt || committedAt < reservedAt) return null;
  const commitAttemptId =
    value.commitAttemptId === undefined ? legacyAttempt(effectId) : nonEmpty(value.commitAttemptId);
  if (!commitAttemptId) return null;
  return {
    effectId,
    requestId,
    descriptor,
    stage,
    reservedAt,
    committedAt,
    commitAttemptId,
  };
}

function normalizeReceipt(value: unknown): EffectReceipt | null {
  if (!isRecord(value)) return null;
  const effectId = sanitizeEffectId(value.effectId);
  const requestId = nonEmpty(value.requestId);
  const descriptor = sanitizeEffectDescriptor(value.descriptor);
  const reservedAt = isoTimestamp(value.reservedAt);
  const outcome = isEffectOutcome(value.outcome) ? value.outcome : null;
  const accounting =
    value.accounting === 'pending' || value.accounting === 'applied' ? value.accounting : null;
  if (!effectId || !requestId || !descriptor || !reservedAt || !outcome || !accounting) return null;

  const committedAt = value.committedAt === undefined ? null : isoTimestamp(value.committedAt);
  if (value.committedAt !== undefined && !committedAt) return null;
  if (committedAt && committedAt < reservedAt) return null;
  if ((outcome === 'confirmed' || outcome === 'uncertain') && !committedAt) return null;
  const settledAt =
    value.settledAt === undefined ? (committedAt ?? reservedAt) : isoTimestamp(value.settledAt);
  if (!settledAt) return null;
  if (settledAt < reservedAt || (committedAt && settledAt < committedAt)) return null;
  const rawAttempt = value.commitAttemptId === undefined ? null : nonEmpty(value.commitAttemptId);
  if (value.commitAttemptId !== undefined && !rawAttempt) return null;
  if (rawAttempt && !committedAt) return null;
  const commitAttemptId = committedAt ? (rawAttempt ?? legacyAttempt(effectId)) : null;
  const reason = nonEmpty(value.reason);
  return {
    effectId,
    requestId,
    descriptor,
    reservedAt,
    ...(committedAt ? { committedAt } : {}),
    ...(commitAttemptId ? { commitAttemptId } : {}),
    outcome,
    ...(reason ? { reason } : {}),
    settledAt,
    accounting,
  };
}

function sanitizePerson(value: unknown): EffectPerson | null {
  if (!isRecord(value)) return null;
  const memberId = nonEmpty(value.memberId);
  if (
    !memberId ||
    typeof value.name !== 'string' ||
    typeof value.headline !== 'string' ||
    typeof value.profileUrl !== 'string'
  ) {
    return null;
  }
  return {
    memberId,
    name: value.name,
    headline: value.headline,
    profileUrl: value.profileUrl,
  };
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(ISO_TIMESTAMP);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute > 0))
      return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function legacyAttempt(effectId: string): string {
  return `legacy:${effectId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Historical outgoing-invite withdrawals are no longer an effect kind. Drop them so a finished run can start again. */
function isRemovedWithdrawEntry(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.descriptor)) return false;
  return value.descriptor.kind === 'withdraw';
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
