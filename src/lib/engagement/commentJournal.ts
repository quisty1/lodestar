import { isoWeekKey } from '../content/PostWeekBudget';
import { asArray } from './settings';

export const COMMENT_JOURNAL_KEY = 'comments:journal';

export interface CommentJournalEntry {
  id: string;
  text: string;
  author: string;
  postUrn: string;
  at: string;
}

export function appendCommentJournal(
  existing: unknown,
  entry: CommentJournalEntry,
  cap = 100,
): CommentJournalEntry[] {
  const current = asArray<CommentJournalEntry>(existing);
  if (current.some((item) => item.postUrn === entry.postUrn || item.id === entry.id))
    return current;
  return [entry, ...current].slice(0, cap);
}

export function commentsInWeek(entries: CommentJournalEntry[], weekKey: string): number {
  return entries.filter((entry) => {
    const at = new Date(entry.at);
    return Number.isFinite(at.getTime()) && isoWeekKey(at) === weekKey;
  }).length;
}
