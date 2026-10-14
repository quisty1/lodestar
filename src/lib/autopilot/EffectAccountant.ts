import type { KeyValueStore } from '../ports';
import type { EffectReceipt } from '../types';
import { asArray } from '../engagement/settings';
import {
  COMMENT_ACTED_KEY,
  COMMENT_BUDGET_KEY,
  recordCommentDayEffect,
  type CommentDay,
} from '../engagement/CommentDayBudget';
import {
  CONNECT_DAY_BUDGET_KEY,
  CONNECT_WEEK_BUDGET_KEY,
  recordConnectDayEffect,
  recordConnectWeekEffect,
  type ConnectDay,
  type ConnectWeek,
} from '../connect/ConnectWeekBudget';
import {
  appendConnectHistory,
  CONNECT_HISTORY_EFFECT_IDS_KEY,
  CONNECT_HISTORY_KEY,
  CONNECT_SENT_KEY,
} from '../connect/ConnectHistory';
import {
  recordViewDayEffect,
  VIEW_DAY_BUDGET_KEY,
  VIEW_SEEN_KEY,
  type ViewDay,
} from '../views/ViewDayBudget';
import {
  appendViewHistory,
  VIEW_HISTORY_EFFECT_IDS_KEY,
  VIEW_HISTORY_KEY,
} from '../views/ViewHistory';
import {
  isoWeekKey,
  POST_WEEK_BUDGET_KEY,
  recordPostWeekEffect,
  type PostWeek,
} from '../content/PostWeekBudget';
import { DraftStore } from '../content/DraftStore';

const STORE_TAILS = new WeakMap<KeyValueStore, Promise<void>>();

/**
 * Applies durable receipt accounting. Every sink is idempotent. Production
 * creates one accountant/service pair; the shared store tail also fences
 * accidental duplicate instances in the same worker realm.
 */
export class EffectAccountant {
  constructor(private readonly store: KeyValueStore) {}

  apply(receipt: EffectReceipt): Promise<void> {
    const tail = STORE_TAILS.get(this.store) ?? Promise.resolve();
    const result = tail.then(
      () => this.applyReceipt(receipt),
      () => this.applyReceipt(receipt),
    );
    STORE_TAILS.set(
      this.store,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  private async applyReceipt(receipt: EffectReceipt): Promise<void> {
    if (
      receipt.outcome === 'failed' ||
      receipt.outcome === 'cancelled' ||
      receipt.outcome === 'already'
    )
      return;
    const reservedAt = new Date(receipt.reservedAt);
    if (!Number.isFinite(reservedAt.getTime())) throw new Error('invalid_effect_reserved_at');
    const day = reservedAt.toISOString().slice(0, 10);
    const week = isoWeekKey(reservedAt);
    const isConfirmed = receipt.outcome === 'confirmed';

    switch (receipt.descriptor.kind) {
      case 'like':
        // Global used/timestamp accounting is atomic with settlement in RunCoordinator.
        return;
      case 'comment': {
        const current = await this.store.get<CommentDay>(COMMENT_BUDGET_KEY);
        await this.store.set(
          COMMENT_BUDGET_KEY,
          recordCommentDayEffect(current, day, receipt.effectId),
        );
        await this.addToSet(COMMENT_ACTED_KEY, receipt.descriptor.targetKey, 5_000);
        return;
      }
      case 'connect': {
        const weekCounter = await this.store.get<ConnectWeek>(CONNECT_WEEK_BUDGET_KEY);
        await this.store.set(
          CONNECT_WEEK_BUDGET_KEY,
          recordConnectWeekEffect(weekCounter, week, receipt.effectId),
        );
        const dayCounter = await this.store.get<ConnectDay>(CONNECT_DAY_BUDGET_KEY);
        await this.store.set(
          CONNECT_DAY_BUDGET_KEY,
          recordConnectDayEffect(dayCounter, day, receipt.effectId),
        );
        await this.addToSet(CONNECT_SENT_KEY, receipt.descriptor.person.memberId, 5_000);
        if (isConfirmed) {
          const applied = asArray<string>(await this.store.get(CONNECT_HISTORY_EFFECT_IDS_KEY));
          if (!applied.includes(receipt.effectId)) {
            const history = await this.store.get(CONNECT_HISTORY_KEY);
            await this.store.set(
              CONNECT_HISTORY_KEY,
              appendConnectHistory(history, [
                {
                  ...receipt.descriptor.person,
                  sentAt: receipt.settledAt,
                  effectId: receipt.effectId,
                },
              ]),
            );
            await this.addToSet(CONNECT_HISTORY_EFFECT_IDS_KEY, receipt.effectId);
          }
        }
        return;
      }
      case 'profile_view': {
        const counter = await this.store.get<ViewDay>(VIEW_DAY_BUDGET_KEY);
        await this.store.set(
          VIEW_DAY_BUDGET_KEY,
          recordViewDayEffect(counter, day, receipt.effectId),
        );
        await this.addToSet(VIEW_SEEN_KEY, receipt.descriptor.person.memberId, 5_000);
        if (isConfirmed) {
          const applied = asArray<string>(await this.store.get(VIEW_HISTORY_EFFECT_IDS_KEY));
          if (!applied.includes(receipt.effectId)) {
            const history = await this.store.get(VIEW_HISTORY_KEY);
            await this.store.set(
              VIEW_HISTORY_KEY,
              appendViewHistory(history, [
                {
                  ...receipt.descriptor.person,
                  viewedAt: receipt.settledAt,
                  effectId: receipt.effectId,
                },
              ]),
            );
            await this.addToSet(VIEW_HISTORY_EFFECT_IDS_KEY, receipt.effectId);
          }
        }
        return;
      }
      case 'publish': {
        const counter = await this.store.get<PostWeek>(POST_WEEK_BUDGET_KEY);
        await this.store.set(
          POST_WEEK_BUDGET_KEY,
          recordPostWeekEffect(counter, week, receipt.effectId),
        );
        const drafts = new DraftStore(this.store);
        if (isConfirmed) await drafts.remove(receipt.descriptor.draftId);
        else await drafts.setApproved(receipt.descriptor.draftId, false);
      }
    }
  }

  private async addToSet(key: string, value: string, cap?: number): Promise<void> {
    const current = asArray<string>(await this.store.get<string[]>(key));
    if (current.includes(value)) return;
    const next = [...current, value];
    await this.store.set(key, cap ? next.slice(-cap) : next);
  }
}
