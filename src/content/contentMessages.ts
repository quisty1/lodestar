import { FeedReader } from '@lib/feed/FeedReader';
import { assertNever, type LodestarMessage, type FeedItem } from '@lib/types';
import { send } from './contentTiming';
import {
  goToNextPeoplePage,
  harvestByScrolling,
  harvestPeopleMessage,
  harvestProfilesMessage,
  harvestPymkMessage,
} from './feedHarvest';
import { hideActivity, showActivity } from './activityOverlay';
import type { HumanDelay } from '@lib/engagement/HumanDelay';
import type { SsiParser } from '@lib/ssi/SsiParser';
import type { DomSsiSource } from '@/adapters/DomSsiSource';
import { parseAndReport } from './ssiPage';

export function registerContentMessages(input: {
  parser: SsiParser;
  source: DomSsiSource;
  feed: FeedReader;
  delay: HumanDelay;
}): void {
  const { parser, source, feed, delay } = input;
  chrome.runtime.onMessage.addListener((message: LodestarMessage, _sender, sendResponse) => {
    switch (message.type) {
      case 'REQUEST_SSI':
        parseAndReport(parser, source);
        sendResponse({ ok: true });
        return false;
      case 'REQUEST_FEED_HARVEST': {
        const items: FeedItem[] = feed
          .parse(document, message.limit)
          .map((post) => ({ id: post.urn, author: post.authorName, excerpt: post.text }));
        send({ type: 'FEED_ITEMS', payload: items });
        sendResponse({ ok: true });
        return false;
      }
      case 'REQUEST_FEED_POSTS':
        void harvestByScrolling(feed, delay, message.limit).then(sendResponse);
        return true;
      case 'HARVEST_PEOPLE_PAGE':
        void harvestPeopleMessage().then(sendResponse);
        return true;
      case 'HARVEST_PROFILES_PAGE':
        void harvestProfilesMessage().then(sendResponse);
        return true;
      case 'PEOPLE_NEXT_PAGE':
        void goToNextPeoplePage().then(sendResponse);
        return true;
      case 'HARVEST_PYMK':
        void harvestPymkMessage(message.target, message.profiles === true).then(sendResponse);
        return true;
      case 'SET_ACTIVITY':
        if (message.active) showActivity(document, message.label ?? '');
        else hideActivity();
        return false;
      case 'SSI_SNAPSHOT':
      case 'SSI_PARSE_FAILED':
      case 'PROFILE_VIEWS_SNAPSHOT':
      case 'FEED_ITEMS':
      case 'REQUEST_REFRESH':
      case 'FORCE_REFRESH':
      case 'START_PROFILE_AUDIT':
      case 'READ_PROFILE_AUDIT':
      case 'START_AUTOPILOT':
      case 'GET_AUTOPILOT_STATUS':
      case 'STOP_AUTOPILOT':
      case 'AUTOPILOT_ATTACH':
      case 'AUTOPILOT_RUN_LOOP':
      case 'AUTOPILOT_MAY_ACT':
      case 'AUTOPILOT_ACTED':
      case 'AUTOPILOT_RESERVE_EFFECT':
      case 'AUTOPILOT_COMMIT_EFFECT':
      case 'AUTOPILOT_SETTLE_EFFECT':
      case 'AUTOPILOT_RISK':
      case 'AUTOPILOT_ENDED':
      case 'AUTOPILOT_STATUS':
      case 'AUTOPILOT_STAGE':
      case 'AUTOPILOT_REPORT':
      case 'LIST_REPORTS':
      case 'LIST_MODELS':
      case 'GENERATE_DRAFT':
      case 'GENERATE_IDEAS':
      case 'EXTRACT_RUN_IDEAS':
      case 'COMMENT_ON_POST':
      case 'PONG':
      case 'PING':
      case 'ACCEPT_INCOMING':
      case 'RECORD_COMMENT':
      case 'REFRESH_INBOUND':
      case 'EXECUTE_ACTION':
      case 'DWELL_PROFILE':
      case 'SLEEP':
        return false;
      default:
        return assertNever(message);
    }
  });
}
