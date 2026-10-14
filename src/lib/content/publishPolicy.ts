import type { Draft } from '../types';

export function shouldPublishToday(args: {
  weekday: number;
  publishDays: number[];
  remainingPosts: number;
  hasApproved: boolean;
}): boolean {
  return args.publishDays.includes(args.weekday) && args.remainingPosts > 0 && args.hasApproved;
}

function canAutoPublish(draft: Draft): boolean {
  return draft.approved === true && draft.kind !== 'repost' && draft.mediaAttached !== false;
}

export function pickOldestApproved(drafts: Draft[]): Draft | null {
  const approved = drafts.filter(canAutoPublish);
  if (!approved.length) return null;
  return approved.reduce((oldest, d) => (d.createdAt < oldest.createdAt ? d : oldest));
}

/** Approved posts that are waiting on media, so the report can say why nothing went out. */
export function approvedWaitingOnMedia(drafts: Draft[]): boolean {
  return (
    drafts.some(
      (draft) =>
        draft.approved === true && draft.kind !== 'repost' && draft.mediaAttached === false,
    ) && !drafts.some(canAutoPublish)
  );
}
