import type { ActionRequest, EffectExecutionToken } from '@lib/types';
import type { EffectExecutionObservation, EffectExecutionResult } from './EffectRuntimeClient';
import type { ActionResult } from './domActions';

export function effectMatchesAction(token: EffectExecutionToken, action: ActionRequest): boolean {
  const descriptor = token.descriptor;
  const meta = action.target.meta ?? {};
  if (action.type === 'connect' && descriptor.kind === 'connect') {
    return (
      descriptor.targetKey === descriptor.person.memberId &&
      meta.memberId === descriptor.person.memberId &&
      meta.name === descriptor.person.name &&
      sameUrl(action.target.url, descriptor.person.profileUrl)
    );
  }
  if (action.type === 'post' && descriptor.kind === 'publish') {
    return meta.draftId === descriptor.draftId && descriptor.targetKey === descriptor.draftId;
  }
  return false;
}

export function actionObservation(result: ActionResult): EffectExecutionObservation {
  if (result.ok) return { outcome: result.already ? 'already' : 'confirmed' };
  if (result.uncertain) return { outcome: 'uncertain', reason: result.reason };
  return { outcome: result.reason === 'cancelled' ? 'cancelled' : 'failed', reason: result.reason };
}

export function effectActionResponse(result: EffectExecutionResult) {
  if (result.reserved && result.settled !== true) {
    return {
      ok: false,
      outcome: result.outcome,
      reason: 'effect_unsettled' as const,
      safetySpent: true,
    };
  }
  const safetySpent = result.outcome === 'confirmed' || result.outcome === 'uncertain';
  return {
    ok: result.outcome === 'confirmed',
    outcome: result.outcome,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(safetySpent ? { safetySpent: true } : {}),
  };
}

function sameUrl(left: string, right: string): boolean {
  try {
    const normalize = (value: string) => {
      const url = new URL(value, 'https://www.linkedin.com');
      return `${url.origin.toLowerCase()}${url.pathname.replace(/\/+$/, '') || '/'}`;
    };
    return normalize(left) === normalize(right);
  } catch {
    return false;
  }
}
