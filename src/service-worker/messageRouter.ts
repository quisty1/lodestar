import { ChromeCookieCsrfProvider } from '@/adapters/ChromeCookieCsrfProvider';
import { FetchHttpClient } from '@/adapters/FetchHttpClient';
import { randomId } from '@/adapters/randomId';
import { GENERATING_IDEAS } from '@lib/autopilot/statusLabels';
import type { LodestarMessage } from '@lib/types';
import * as content from './contentHandlers';
import {
  broadcast,
  forwardToLinkedInTab,
  harvestPosts,
  withPageActivity,
} from './linkedinTabBridge';
import { recordComment, refreshInbound } from './productSignals';
import type { WorkerContext } from './workerContext';

export function registerServiceWorkerMessages(ctx: WorkerContext): void {
  chrome.runtime.onMessage.addListener((message: LodestarMessage, _sender, sendResponse) => {
    switch (message.type) {
      case 'SSI_SNAPSHOT':
        void ctx.repo.save(message.payload).then(() => {
          broadcast(message);
          sendResponse({ ok: true });
        });
        return true;

      case 'REQUEST_SSI':
        void forwardToLinkedInTab(message);
        return false;

      case 'REQUEST_REFRESH':
        ctx.refreshMetricsIfDue();
        return false;

      case 'FORCE_REFRESH':
      case 'START_PROFILE_AUDIT':
      case 'READ_PROFILE_AUDIT':
      case 'LIST_MODELS':
      case 'GET_AUTOPILOT_STATUS':
      case 'START_AUTOPILOT':
      case 'STOP_AUTOPILOT':
      case 'AUTOPILOT_RISK':
      case 'AUTOPILOT_ENDED':
      case 'AUTOPILOT_MAY_ACT':
      case 'AUTOPILOT_ACTED':
      case 'EXTRACT_RUN_IDEAS':
      case 'COMMENT_ON_POST':
      case 'PING':
        return false;

      case 'GENERATE_DRAFT':
        void content
          .generateDraft(
            { store: ctx.store, http: ctx.llmHttp, clock: ctx.clock, newId: randomId },
            message.idea,
          )
          .then(sendResponse);
        return true;

      case 'GENERATE_IDEAS':
        void withPageActivity(
          () =>
            content.generateIdeas({
              store: ctx.store,
              http: ctx.llmHttp,
              harvest: harvestPosts,
            }),
          GENERATING_IDEAS,
        ).then(sendResponse);
        return true;

      case 'LIST_REPORTS':
        void ctx.reportsStore.list().then(sendResponse);
        return true;

      case 'RECORD_COMMENT':
        void recordComment(ctx.store, message.entry).then(() => {
          sendResponse({ ok: true });
        });
        return true;

      case 'REFRESH_INBOUND':
        void refreshInbound(
          ctx.store,
          new FetchHttpClient(),
          new ChromeCookieCsrfProvider(),
          ctx.clock.now(),
        )
          .then(sendResponse)
          .catch(() => {
            sendResponse(null);
          });
        return true;

      default:
        return false;
    }
  });
}
