import type { AutopilotState, EffectReceipt, RunReport } from '@lib/types';
import { asArray } from '@lib/engagement/settings';
import type { CommentJournalEntry } from '@lib/engagement/commentJournal';

export interface DayCount {
  confirmed: number;
  budget: number;
}

export interface DayStats {
  views: DayCount;
  connects: DayCount;
  ideas: DayCount;
  likes: DayCount;
  comments: DayCount;
  posts: DayCount;
}

export function emptyDayStats(): DayStats {
  const zero = { confirmed: 0, budget: 0 };
  return {
    views: { ...zero },
    connects: { ...zero },
    ideas: { ...zero },
    likes: { ...zero },
    comments: { ...zero },
    posts: { ...zero },
  };
}

function dayUsed(value: unknown, today: string): number {
  if (!value || typeof value !== 'object' || !('day' in value) || !('used' in value)) return 0;
  const entry = value;
  return entry.day === today && typeof entry.used === 'number' ? entry.used : 0;
}

function onDay(iso: string | undefined, today: string): boolean {
  return typeof iso === 'string' && iso.startsWith(today);
}

/** Confirmed actions from the live ledger and earlier reports, beside the defensive day counters. */
export function projectDayStats(input: {
  today: string;
  state: AutopilotState | null;
  reports: RunReport[];
  views: unknown;
  connects: unknown;
  ideas: unknown;
  comments: unknown;
  journal: unknown;
}): DayStats {
  const stats = emptyDayStats();
  const state = input.state;
  const liveRunId = state?.runId;
  const receipts = Object.values<EffectReceipt>(state?.effectLedger?.receipts ?? {});
  const liveReceipts = receipts.filter((receipt) => onDay(receipt.settledAt, input.today));
  const journal = asArray<CommentJournalEntry>(input.journal).filter(
    (entry) => onDay(entry.at, input.today) && !(liveRunId && entry.id.startsWith(`${liveRunId}:`)),
  );
  const commentKeys = new Set(journal.map((entry) => entry.postUrn));

  for (const receipt of liveReceipts) {
    if (receipt.outcome !== 'confirmed' && receipt.outcome !== 'uncertain') continue;
    const kind = receipt.descriptor.kind;
    if (receipt.outcome === 'uncertain') {
      if (kind === 'publish') stats.posts.budget += 1;
      continue;
    }
    if (kind === 'like') stats.likes.confirmed += 1;
    else if (kind === 'profile_view') stats.views.confirmed += 1;
    else if (kind === 'connect') stats.connects.confirmed += 1;
    else if (kind === 'publish') {
      stats.posts.confirmed += 1;
      stats.posts.budget += 1;
    } else if (kind === 'comment') {
      const key = receipt.descriptor.postUrn ?? receipt.descriptor.targetKey;
      if (!commentKeys.has(key)) stats.comments.confirmed += 1;
    }
  }
  stats.comments.confirmed += journal.length;

  for (const report of input.reports) {
    if (!onDay(report.startedAt, input.today) || report.id === liveRunId) continue;
    for (const row of report.modules) {
      const executed = row.executed ?? 0;
      if (row.id === 'engagement') stats.likes.confirmed += executed;
      else if (row.id === 'profile_views') stats.views.confirmed += executed;
      else if (row.id === 'smart_connect') stats.connects.confirmed += executed;
      else if (row.id === 'content') {
        stats.posts.confirmed += executed;
        stats.posts.budget += executed;
      }
    }
  }

  stats.views.budget = dayUsed(input.views, input.today);
  stats.connects.budget = dayUsed(input.connects, input.today);
  stats.comments.budget = dayUsed(input.comments, input.today);
  stats.ideas.budget = dayUsed(input.ideas, input.today);
  stats.ideas.confirmed = stats.ideas.budget;
  stats.likes.budget =
    state?.day === input.today && typeof state.used === 'number' ? state.used : 0;
  return stats;
}
