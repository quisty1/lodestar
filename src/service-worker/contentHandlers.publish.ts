// Post-publishing SW handlers. All deps injected → unit-testable with fakes.
import { loadContentSettings } from '@lib/content/settings';
import { DraftStore } from '@lib/content/DraftStore';
import {
  isoWeekKey,
  rolloverPostWeek,
  remainingPosts,
  POST_WEEK_BUDGET_KEY,
  type PostWeek,
} from '@lib/content/PostWeekBudget';
import { approvedWaitingOnMedia, pickOldestApproved } from '@lib/content/publishPolicy';
import { enabledModules } from '@lib/autopilot/startGate';
import { ACCOUNT_KEY, isLinkedInAccount } from '@lib/linkedin/account';
import type { Clock, KeyValueStore } from '@lib/ports';
import type { Draft } from '@lib/types';

export interface PublishApprovedDeps {
  store: KeyValueStore;
  clock: Clock;
  prepare: () => Promise<void>;
  publish: (
    text: string,
    draft: Draft,
  ) => Promise<
    | {
        ok: boolean;
        reason?: string;
        safetySpent?: boolean;
      }
    | undefined
  >;
  cancelled?: () => boolean | Promise<boolean>;
}

/** Auto-publish step: publish ONE oldest approved draft if today∈publishDays AND weekly cap left. */
export async function publishApprovedDrafts(
  deps: PublishApprovedDeps,
): Promise<{ published: number; reason?: string }> {
  const modulesState = await deps.store.get('modules:state');
  if (await isCancelled(deps.cancelled)) return { published: 0, reason: 'cancelled' };
  if (!enabledModules(modulesState).some((m) => m.id === 'content'))
    return { published: 0, reason: 'disabled' };

  const now = deps.clock.now();
  const drafts = new DraftStore(deps.store);
  const [{ publishDays, postsPerWeek }, rawBudget, all] = await Promise.all([
    loadContentSettings(deps.store),
    deps.store.get<PostWeek>(POST_WEEK_BUDGET_KEY),
    drafts.all(),
  ]);
  if (await isCancelled(deps.cancelled)) return { published: 0, reason: 'cancelled' };
  const budget = rolloverPostWeek(rawBudget ?? null, isoWeekKey(now));
  const draft = pickOldestApproved(all);

  // Granular gate so a no-publish run names its reason in the report (never silent):
  // not_publish_day | weekly_cap | no_approved_draft. Precedence is "most global first".
  if (!publishDays.includes(now.getDay())) return { published: 0, reason: 'not_publish_day' };
  if (remainingPosts(budget, postsPerWeek) <= 0) return { published: 0, reason: 'weekly_cap' };
  if (!draft) {
    return {
      published: 0,
      reason: approvedWaitingOnMedia(all) ? 'needs_media' : 'no_approved_draft',
    };
  }
  const account = await deps.store.get(ACCOUNT_KEY);
  if (!isLinkedInAccount(account)) return { published: 0, reason: 'account_unknown' };
  if (draft.accountId !== account.id) return { published: 0, reason: 'wrong_account' };

  await deps.prepare();
  if (await isCancelled(deps.cancelled)) return { published: 0, reason: 'cancelled' };
  const fresh = (await drafts.all()).find((item) => item.id === draft.id);
  if (
    !fresh ||
    fresh.approved !== true ||
    fresh.kind === 'repost' ||
    fresh.mediaAttached === false
  ) {
    return { published: 0, reason: 'no_approved_draft' };
  }
  if (fresh.accountId !== account.id) return { published: 0, reason: 'wrong_account' };
  const res = await deps.publish(fresh.text, fresh);
  // A lost response can hide a committed post. The caller stops the run and the effect
  // finalizer resolves accounting; this layer must not mutate the draft directly.
  if (res === undefined) {
    return { published: 0, reason: 'uncertain' };
  }
  if (res.safetySpent && !res.ok) return { published: 0, reason: 'uncertain' };
  if (!res.ok) return { published: 0, reason: res.reason ?? 'publish_failed' };

  return { published: 1, reason: 'done' };
}

async function isCancelled(check?: () => boolean | Promise<boolean>): Promise<boolean> {
  return check ? await check() : false;
}
