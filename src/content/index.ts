// Content script: the only layer that runs inside the LinkedIn page DOM.
// Harvest, the feed loop, and message routing live in their own modules.

import { createSsiParser } from '@lib/ssi/createSsiParser';
import { FeedReader } from '@lib/feed/FeedReader';
import { LikeFilter } from '@lib/engagement/LikeFilter';
import { HumanBreakPolicy } from '@lib/autopilot/HumanBreakPolicy';
import { HumanDelay } from '@lib/engagement/HumanDelay';
import { DomSsiSource } from '@/adapters/DomSsiSource';
import { SystemClock } from '@/adapters/SystemClock';
import { MathRandomRng } from '@/adapters/MathRandomRng';
import { executeProfileView } from './profileView';
import { acceptIncoming } from './acceptIncoming';
import { clearActivity, countdownActivity } from './activityOverlay';
import { pauseLabel } from '@lib/autopilot/statusLabels';
import { ContentRunSession } from './runSession';
import { registerContentAutopilotRuntime } from './autopilotRuntime';
import { registerProfileAuditContentRuntime, waitForProfileSnapshot } from './profileAuditRuntime';
import { readProfile } from './readProfile';
import { registerScopedContentActionRuntime } from './scopedActionRuntime';
import { EffectRuntimeClient } from './EffectRuntimeClient';
import { inspectLinkedInDom } from '@lib/linkedin/domContract';
import { sleep, sleepUntilCancelled } from './contentTiming';
import { watchSsiDashboard } from './ssiPage';
import { registerContentMessages } from './contentMessages';
import { runAction } from './contentAction';
import { endRun, runAutopilotLoop } from './autopilotFeedLoop';

const parser = createSsiParser(new SystemClock());
const source = new DomSsiSource();
const feed = new FeedReader();
const delay = new HumanDelay(new MathRandomRng());
const likeFilter = new LikeFilter();
const humanBreak = new HumanBreakPolicy();
const commentRng = new MathRandomRng();
const runSession = new ContentRunSession();
const effectClient = new EffectRuntimeClient({
  send: async (message) => {
    const response = (await chrome.runtime.sendMessage(message)) as unknown;
    if (response === undefined) throw new Error('effect_response_missing');
    return response;
  },
  createId: () => crypto.randomUUID(),
});
const loopDeps = { runSession, effectClient, likeFilter, humanBreak, commentRng, delay, feed };

registerContentAutopilotRuntime(chrome.runtime.onMessage, {
  session: runSession,
  currentUrl: () => location.href,
  inspectDom: () => inspectLinkedInDom(document, location.href),
  startRunLoop: (runId, modules) => runAutopilotLoop(loopDeps, runId, modules),
  endRun: (runId, reason) => endRun(runSession, runId, reason),
  clearActivity: () => {
    clearActivity(document);
  },
});

registerProfileAuditContentRuntime(chrome.runtime.onMessage, {
  read: () =>
    waitForProfileSnapshot(
      () => readProfile(document, location.href, new Date().toISOString()),
      sleep,
    ),
});

registerScopedContentActionRuntime(chrome.runtime.onMessage, {
  session: runSession,
  currentUrl: () => location.href,
  acceptIncoming: (_runId, cap, shouldAbort) =>
    acceptIncoming(document, cap, {
      shouldAbort,
      nextDelay: () => delay.nextMs(3000, 8000),
      sleep: sleepUntilCancelled,
    }),
  executeAction: (action, shouldAbort, effect) =>
    runAction(effectClient, delay, action, shouldAbort, effect),
  dwell: (shouldAbort) => executeProfileView(document, delay, shouldAbort),
  sleep: (ms, shouldAbort) => countdownActivity(ms, pauseLabel, shouldAbort),
});

registerContentMessages({ parser, source, feed, delay });
watchSsiDashboard(parser, source);
