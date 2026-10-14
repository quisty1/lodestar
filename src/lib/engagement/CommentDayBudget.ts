import { recordEffectForPeriod } from '../autopilot/EffectCounter';

export const COMMENT_BUDGET_KEY = 'comments:budget';
export const COMMENT_ACTED_KEY = 'comments:acted';

export interface CommentDay {
  day: string;
  used: number;
  effectIds?: string[];
}

export function recordCommentDayEffect(
  current: CommentDay | null,
  day: string,
  effectId: string,
  n = 1,
): CommentDay {
  return recordEffectForPeriod(current, current?.day, day, () => ({ day, used: 0 }), effectId, n);
}
