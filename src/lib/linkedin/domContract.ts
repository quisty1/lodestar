import type { LinkedInDomCapabilities, LinkedInDomContract, LinkedInSurface } from '../types';
import {
  COMMENT_OPEN_LABELS,
  COMMENT_SUBMIT_LABELS,
  CONTROL_MENU_AUTHOR_PREFIXES,
  FEED_EMPTY_LABELS,
  NO_REACTION_LABELS,
  PEOPLE_EMPTY_LABELS,
  REACTION_LABEL_PREFIXES,
  SSI_PAGE_MARKERS,
  authorFromControlLabel,
  hasExactPrefix,
  isExactLabel,
  nameFromConnectLabel,
  normalizeText,
  pageNumberFromLabel,
} from './localeLexicon';

const REACTION_STRUCTURAL = [
  'button[data-view-name="feed-react-button"]',
  'button[componentkey*="ReactionButton"]',
].join(',');
const COMMENT_STRUCTURAL = [
  'button[data-view-name="feed-comment-button"]',
  'button[componentkey*="CommentButton"]',
].join(',');
const CONNECT_STRUCTURAL = '[componentkey*="urn:li:member:"][componentkey$="_connect"]';

export type ReactionState = 'unreacted' | 'reacted' | 'unknown';

export function findReactionControl(root: ParentNode): HTMLElement | null {
  const structural = root.querySelector<HTMLElement>(REACTION_STRUCTURAL);
  if (structural) return structural;
  return findByLabelPrefix(root, 'button', REACTION_LABEL_PREFIXES);
}

export function reactionState(control: Element): ReactionState {
  const pressed = control.getAttribute('aria-pressed');
  if (pressed === 'false') return 'unreacted';
  if (pressed === 'true') return 'reacted';
  const state = normalizeText(control.getAttribute('data-reaction-state')).toLowerCase();
  if (state === 'none' || state === 'no-reaction') return 'unreacted';
  if (state && state !== 'unknown') return 'reacted';
  const label = control.getAttribute('aria-label');
  if (isExactLabel(label, NO_REACTION_LABELS)) return 'unreacted';
  if (hasExactPrefix(label, REACTION_LABEL_PREFIXES)) return 'reacted';
  return 'unknown';
}

export function findCommentControl(root: ParentNode): HTMLElement | null {
  const structural = root.querySelector<HTMLElement>(COMMENT_STRUCTURAL);
  if (structural) return structural;
  return findByExactLabel(root, 'button', COMMENT_OPEN_LABELS);
}

export function findCommentSubmit(editor: Element): HTMLElement | null {
  let node: Element | null = editor;
  for (let depth = 0; depth < 8 && node; depth += 1) {
    const buttons = [...node.querySelectorAll<HTMLButtonElement>('button')];
    const structural = buttons.filter(
      (button) =>
        button.getAttribute('data-view-name') === 'comment-submit' ||
        button.getAttribute('data-testid') === 'comment-submit',
    );
    if (structural.length) {
      return structural.find((button) => !button.disabled) ?? null;
    }
    const localized = buttons.filter((button) =>
      isExactLabel(button.textContent, COMMENT_SUBMIT_LABELS),
    );
    if (localized.length) {
      const enabled = localized.filter((button) => !button.disabled);
      return enabled.find((button) => !button.getAttribute('aria-label')) ?? null;
    }
    node = node.parentElement;
  }
  return null;
}

export function isFeedPostRoot(element: Element): boolean {
  if (!element.getAttribute('componentkey')) return false;
  const reaction = findReactionControl(element);
  return reaction !== null && owningFeedPost(reaction) === element;
}

export function findPostAuthor(element: Element): string | null {
  const structural = normalizeText(
    element.querySelector<HTMLElement>('[data-view-name="feed-author-name"]')?.textContent,
  );
  if (structural) return structural;
  const control = findByLabelPrefix(element, 'button', CONTROL_MENU_AUTHOR_PREFIXES);
  const fromControl = authorFromControlLabel(control?.getAttribute('aria-label'));
  if (fromControl) return fromControl;
  const profile = element.querySelector<HTMLElement>('a[href*="/in/"], a[href*="/company/"]');
  return normalizeText(profile?.textContent) || null;
}

export function findConnectControls(root: ParentNode): HTMLElement[] {
  const out = new Set<HTMLElement>(root.querySelectorAll<HTMLElement>(CONNECT_STRUCTURAL));
  for (const control of root.querySelectorAll<HTMLElement>('[aria-label]')) {
    if (nameFromConnectLabel(control.getAttribute('aria-label'))) out.add(control);
  }
  return [...out];
}

export function readCandidateName(control: Element, card: ParentNode): string {
  const profile = card.querySelector<HTMLElement>('a[href*="/in/"]');
  const structural = normalizeText(profile?.textContent).split('•')[0].trim();
  return structural || nameFromConnectLabel(control.getAttribute('aria-label')) || '';
}

export function readCurrentPage(root: ParentNode): number | null {
  const current = pageControls(root).find((button) => {
    const state = button.getAttribute('aria-current');
    return state === 'true' || state === 'page';
  });
  return current ? readPageNumber(current) : null;
}

export function findNextPageControl(root: ParentNode, current: number): HTMLButtonElement | null {
  return (
    pageControls(root).find(
      (button) => readPageNumber(button) === current + 1 && !button.disabled,
    ) ?? null
  );
}

export function isPeopleSearchEmpty(root: ParentNode): boolean {
  const structural = root.querySelector(
    '[data-view-name="search-no-results"], [data-testid="no-results"]',
  );
  if (structural && isExactLabel(structural.textContent, PEOPLE_EMPTY_LABELS)) return true;
  return [...root.querySelectorAll('main h1, main h2, main h3')].some((element) =>
    isExactLabel(element.textContent, PEOPLE_EMPTY_LABELS),
  );
}

export function inspectLinkedInDom(root: ParentNode, url: string): LinkedInDomContract {
  const surface = linkedinSurface(url);
  const capabilities = absentCapabilities();
  if (surface === 'feed') inspectFeed(root, capabilities);
  if (surface === 'people_search' || surface === 'pymk') inspectPeople(root, capabilities);
  if (surface === 'profile')
    capabilities.profile = root.querySelector('main, [role="main"]') ? 'ready' : 'unsupported_dom';
  if (surface === 'ssi') inspectSsi(root, capabilities);
  return { surface, capabilities };
}

export function linkedinSurface(url: string): LinkedInSurface {
  try {
    const path = new URL(url, 'https://www.linkedin.com/').pathname.replace(/\/+$/, '');
    if (path === '/feed') return 'feed';
    if (path === '/search/results/people') return 'people_search';
    if (path === '/mynetwork/grow') return 'pymk';
    if (path.startsWith('/in/')) return 'profile';
    if (path.startsWith('/sales/ssi')) return 'ssi';
  } catch {
    /* unsupported URL */
  }
  return 'unknown';
}

function inspectFeed(root: ParentNode, capabilities: LinkedInDomCapabilities): void {
  const posts = [...root.querySelectorAll('[componentkey]')].filter(isFeedPostRoot);
  if (posts.length) {
    capabilities.feed = 'ready';
    capabilities.like = posts.some((post) => {
      const control = findReactionControl(post);
      return control !== null && reactionState(control) !== 'unknown';
    })
      ? 'ready'
      : 'unsupported_dom';
    capabilities.comment = posts.some((post) => findCommentControl(post))
      ? 'ready'
      : 'unsupported_dom';
    return;
  }
  const empty = [
    ...root.querySelectorAll('main h1, main h2, main h3, [data-view-name="feed-empty"]'),
  ].some((element) => isExactLabel(element.textContent, FEED_EMPTY_LABELS));
  capabilities.feed = empty ? 'absent' : 'unsupported_dom';
}

function inspectPeople(root: ParentNode, capabilities: LinkedInDomCapabilities): void {
  const members = root.querySelectorAll(
    '[componentkey*="urn:li:member:"], [data-view-name="people-search-result"]',
  );
  const empty = isPeopleSearchEmpty(root);
  capabilities.profile = members.length ? 'ready' : empty ? 'absent' : 'unsupported_dom';
  capabilities.connect = findConnectControls(root).length
    ? 'ready'
    : members.length || empty
      ? 'absent'
      : 'unsupported_dom';
  capabilities.pagination =
    readCurrentPage(root) !== null
      ? 'ready'
      : members.length || empty
        ? 'absent'
        : 'unsupported_dom';
}

function inspectSsi(root: ParentNode, capabilities: LinkedInDomCapabilities): void {
  const structural = root.querySelector(
    '[id="establish-brand__sub-score-bar"], [data-lodestar-pillar="brand"]',
  );
  const text = normalizeText(root.textContent).toLocaleLowerCase();
  capabilities.ssi =
    structural || SSI_PAGE_MARKERS.some((marker) => text.includes(marker))
      ? 'ready'
      : 'unsupported_dom';
}

function absentCapabilities(): LinkedInDomCapabilities {
  return {
    feed: 'absent',
    like: 'absent',
    comment: 'absent',
    connect: 'absent',
    pagination: 'absent',
    profile: 'absent',
    ssi: 'absent',
  };
}

function owningFeedPost(control: Element): Element | null {
  let node = control.parentElement;
  while (node && node !== control.ownerDocument.body) {
    if (node.hasAttribute('componentkey') && findPostAuthor(node)) return node;
    node = node.parentElement;
  }
  return null;
}

function pageControls(root: ParentNode): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].filter(
    (button) =>
      button.hasAttribute('data-page-number') ||
      pageNumberFromLabel(button.getAttribute('aria-label')) !== null,
  );
}

function readPageNumber(button: HTMLButtonElement): number | null {
  const structural = Number(button.getAttribute('data-page-number'));
  if (Number.isInteger(structural) && structural > 0) return structural;
  return pageNumberFromLabel(button.getAttribute('aria-label'));
}

function findByExactLabel(
  root: ParentNode,
  tag: string,
  labels: readonly string[],
): HTMLElement | null {
  return (
    [...root.querySelectorAll<HTMLElement>(`${tag}[aria-label]`)].find((element) =>
      isExactLabel(element.getAttribute('aria-label'), labels),
    ) ?? null
  );
}

function findByLabelPrefix(
  root: ParentNode,
  tag: string,
  prefixes: readonly string[],
): HTMLElement | null {
  return (
    [...root.querySelectorAll<HTMLElement>(`${tag}[aria-label]`)].find((element) =>
      hasExactPrefix(element.getAttribute('aria-label'), prefixes),
    ) ?? null
  );
}
