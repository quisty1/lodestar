import type { ActionRequest, EffectExecutionToken } from '@lib/types';
import type { HumanDelay } from '@lib/engagement/HumanDelay';
import { executeComposerPost, executeConnect } from './domActions';
import { actionObservation, effectActionResponse, effectMatchesAction } from './effectAction';
import type { EffectRuntimeClient } from './EffectRuntimeClient';

export async function runAction(
  effectClient: EffectRuntimeClient,
  delay: HumanDelay,
  action: ActionRequest,
  shouldAbort: () => boolean,
  effect: EffectExecutionToken,
) {
  if (shouldAbort()) return { ok: false, reason: 'cancelled' };
  if (!effectMatchesAction(effect, action)) return { ok: false, reason: 'effect_mismatch' };
  const result = await effectClient.executeReserved(effect, async (gate) => {
    const edgeAbort = () => shouldAbort();
    const commit = () => gate.commit();
    const meta = action.target.meta ?? {};
    const textField = (value: unknown) => (typeof value === 'string' ? value : '');
    if (action.type === 'post') {
      return actionObservation(
        await executeComposerPost(document, action.payload?.post ?? '', delay, edgeAbort, commit),
      );
    }
    if (action.type === 'connect') {
      return actionObservation(
        await executeConnect(
          document,
          { memberId: textField(meta.memberId), name: textField(meta.name) },
          delay,
          edgeAbort,
          commit,
        ),
      );
    }
    return { outcome: 'failed' as const, reason: `unsupported_effect_action:${action.type}` };
  });
  return effectActionResponse(result);
}
