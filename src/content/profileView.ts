import type { HumanDelay } from '../lib/engagement/HumanDelay';
import type { ActionResult } from './domActions';

const sleep = (ms: number, shouldAbort: () => boolean): Promise<boolean> =>
  new Promise((resolve) => {
    if (shouldAbort()) {
      resolve(false);
      return;
    }
    const abortPoll = setInterval(() => {
      if (!shouldAbort()) return;
      clearInterval(abortPoll);
      clearTimeout(done);
      resolve(false);
    }, 100);
    const done = setTimeout(() => {
      clearInterval(abortPoll);
      resolve(true);
    }, ms);
  });

/**
 * Human dwell on the already-navigated profile: scroll down a little, pause, scroll further, pause.
 * The actual "view" is registered by the SW navigating to the profile URL; this only adds plausibility.
 * Best-effort — a missing scroll target is not a failure.
 */
export async function executeProfileView(
  root: Document,
  delay: HumanDelay,
  shouldAbort: () => boolean = () => false,
): Promise<ActionResult> {
  if (shouldAbort()) return { ok: false, reason: 'cancelled' };
  const scroller = (root.scrollingElement ?? root.documentElement) as HTMLElement | null;
  scroller?.scrollTo?.({ top: 600, behavior: 'smooth' });
  if (!(await sleep(delay.nextMs(1500, 3500), shouldAbort)))
    return { ok: false, reason: 'cancelled' };
  scroller?.scrollTo?.({ top: 1400, behavior: 'smooth' });
  if (!(await sleep(delay.nextMs(1500, 3500), shouldAbort)))
    return { ok: false, reason: 'cancelled' };
  return { ok: true };
}
