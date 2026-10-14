import type { EffectKind, EffectReceipt, ModuleId, ModuleOutcome, RunReport } from '../types';

/** Fixed display order so the report reads the same way the run executes. */
const MODULE_ORDER: ModuleId[] = ['engagement', 'smart_connect', 'content', 'profile_views'];

/** Reconciles the daily counter into this run's engagement delta without losing WHY it ended. */
export function withEngagementRunDelta(
  outcomes: Partial<Record<ModuleId, ModuleOutcome>>,
  used: number,
  startedUsed: number,
): Partial<Record<ModuleId, ModuleOutcome>> {
  const engagement = outcomes.engagement;
  if (!engagement) return { ...outcomes };
  return {
    ...outcomes,
    engagement: { ...engagement, executed: Math.max(0, used - startedUsed) },
  };
}

const EFFECT_MODULE: Record<EffectKind, ModuleId> = {
  like: 'engagement',
  comment: 'engagement',
  connect: 'smart_connect',
  publish: 'content',
  profile_view: 'profile_views',
};

/**
 * Replaces mutable module tallies with settled ledger evidence. Structural
 * skipped/reason fields stay intact; already/cancelled receipts do not count.
 * Engagement execution means confirmed likes only; comment failures and
 * uncertainty still consume its failure tally and safety accounting.
 */
export function withEffectLedgerOutcomes(
  outcomes: Partial<Record<ModuleId, ModuleOutcome>>,
  receipts: EffectReceipt[],
): Partial<Record<ModuleId, ModuleOutcome>> {
  const counts = new Map<ModuleId, { executed: number; failed: number; touched: boolean }>();
  for (const id of MODULE_ORDER) counts.set(id, { executed: 0, failed: 0, touched: false });

  for (const receipt of receipts) {
    if (receipt.outcome === 'already' || receipt.outcome === 'cancelled') continue;
    const moduleId = EFFECT_MODULE[receipt.descriptor.kind];
    const count = counts.get(moduleId);
    if (!count) continue;
    count.touched = true;
    if (receipt.outcome === 'failed' || receipt.outcome === 'uncertain') count.failed += 1;
    if (receipt.outcome !== 'confirmed') continue;
    switch (receipt.descriptor.kind) {
      case 'like':
        count.executed += 1;
        break;
      case 'connect':
        count.executed += 1;
        break;
      case 'profile_view':
        count.executed += 1;
        break;
      case 'publish':
        count.executed += 1;
        break;
      case 'comment':
        break;
    }
  }

  const result: Partial<Record<ModuleId, ModuleOutcome>> = {};
  for (const id of MODULE_ORDER) {
    const structural = outcomes[id];
    const count = counts.get(id);
    if (!count) continue;
    if (!structural && !count.touched) continue;
    const next: ModuleOutcome = {
      executed: count.executed,
      skipped: structural?.skipped ?? 0,
      failed: count.failed,
      reason: structural?.reason ?? 'done',
    };
    result[id] = next;
  }
  return result;
}

/**
 * Build a run report's module rows from each module's recorded outcome. Every module
 * the run TOUCHED (including ones that executed 0 — disabled, no_keywords, empty_search,
 * not_publish_day, …) gets a row WITH its reason, so a do-nothing run is never silent.
 * Modules with no recorded outcome (never reached) are omitted.
 */
export function buildReportModules(
  outcomes: Partial<Record<ModuleId, ModuleOutcome>>,
): RunReport['modules'] {
  const rows: RunReport['modules'] = [];
  for (const id of MODULE_ORDER) {
    const o = outcomes[id];
    if (!o) continue;
    rows.push({
      id,
      executed: o.executed,
      skipped: o.skipped ?? 0,
      failed: o.failed ?? 0,
      reason: o.reason,
    });
  }
  return rows;
}
