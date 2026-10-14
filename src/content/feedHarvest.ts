import { FeedReader } from '@lib/feed/FeedReader';
import { scrollHarvest } from '@lib/feed/scrollHarvest';
import type { HumanDelay } from '@lib/engagement/HumanDelay';
import {
  findCommentControl,
  findNextPageControl,
  isPeopleSearchEmpty,
  readCurrentPage,
} from '@lib/linkedin/domContract';
import {
  harvestPeople,
  harvestProfiles,
  harvestPeoplePage,
  pymkScrollHarvest,
} from './harvestPeople';
import { sleep } from './contentTiming';

export function feedScroller(): Element {
  const anchor =
    findCommentControl(document) ?? document.querySelector('[data-testid="expandable-text-box"]');
  let node: Element | null = anchor;
  while (node && node !== document.body) {
    node = node.parentElement;
    if (node && node.scrollHeight > node.clientHeight + 80) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') return node;
    }
  }
  return document.scrollingElement ?? document.documentElement;
}

export async function expandPymkShowAll(): Promise<void> {
  const showAll = [...document.querySelectorAll<HTMLElement>('a,button')].find((element) =>
    /you may know based on your recent activity/i.test(element.getAttribute('aria-label') ?? ''),
  );
  if (!showAll) return;
  showAll.click();
  await sleep(2000);
}

export function pymkScroller(): Element {
  const anchor = document.querySelector('[componentkey*="urn:li:member:"]');
  let node: Element | null = anchor;
  while (node && node !== document.body) {
    node = node.parentElement;
    if (node && node.scrollHeight > node.clientHeight + 100) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') return node;
    }
  }
  return document.scrollingElement ?? document.documentElement;
}

export async function goToNextPeoplePage(): Promise<boolean> {
  const current = readCurrentPage(document);
  if (current === null) return false;
  const next = findNextPageControl(document, current);
  if (!next) return false;
  next.scrollIntoView();
  next.click();
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    if (readCurrentPage(document) === current + 1) {
      await sleep(1500);
      return true;
    }
  }
  return false;
}

export function harvestByScrolling(
  feed: FeedReader,
  delay: HumanDelay,
  target: number,
  shouldAbort: () => boolean = () => false,
): Promise<ReturnType<FeedReader['parse']>> {
  return scrollHarvest(target, {
    parse: () => feed.parse(document),
    scrollToBottom: () => {
      const scroller = feedScroller();
      scroller.scrollTop = scroller.scrollHeight;
    },
    sleep: () => sleep(delay.nextMs(1500, 3000)),
    shouldAbort,
  });
}

export function harvestPeopleMessage() {
  return harvestPeoplePage(
    () => harvestPeople(document),
    (ms) => sleep(ms),
    () => isPeopleSearchEmpty(document),
    40,
    500,
    () => harvestProfiles(document).length,
  );
}

export function harvestProfilesMessage() {
  return harvestPeoplePage(
    () => harvestProfiles(document),
    (ms) => sleep(ms),
    () => isPeopleSearchEmpty(document),
  );
}

export function harvestPymkMessage(target: number, profiles: boolean) {
  const harvestFn = profiles ? () => harvestProfiles(document) : () => harvestPeople(document);
  return expandPymkShowAll().then(() =>
    pymkScrollHarvest(
      harvestFn,
      () => {
        const scroller = pymkScroller();
        scroller.scrollTop = scroller.scrollHeight;
        return Promise.resolve();
      },
      () => sleep(1200),
      target,
    ),
  );
}
