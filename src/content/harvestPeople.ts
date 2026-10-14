import type { PersonCandidate, HarvestResult } from '@lib/types';
import { findConnectControls, readCandidateName } from '@lib/linkedin/domContract';

/**
 * Parse connectable people from a LinkedIn people-search or PYMK results DOM.
 * Anchors off the Connect control (`<a>` or `<button>`), reads memberId from its componentkey,
 * walks up to the card to read the headline (the 2nd <p>). Structural, jsdom-safe.
 */
export function harvestPeople(root: ParentNode): PersonCandidate[] {
  const out: PersonCandidate[] = [];
  const seen = new Set<string>();
  for (const el of findConnectControls(root)) {
    const member = (el.getAttribute('componentkey') ?? '').match(/urn:li:member:(\d+)/)?.[1];
    if (!member || seen.has(member)) continue;
    let card: Element | null = el.parentElement;
    while (card && !card.querySelector('a[href*="/in/"]')) card = card.parentElement;
    if (!card) continue;
    const profile = card.querySelector<HTMLAnchorElement>('a[href*="/in/"]');
    const ps = card.querySelectorAll('p');
    seen.add(member);
    out.push({
      memberId: member,
      name: readCandidateName(el, card),
      headline: (ps[1]?.textContent ?? '').trim(),
      profileUrl: (profile?.getAttribute('href') ?? '').split('?')[0],
    });
  }
  return out;
}

/**
 * Parse ALL people from a people-search results DOM, regardless of connection status —
 * connectable AND already-invited ("Pending"). Profile Views must visit a profile no matter
 * its connect state, unlike harvestPeople which keys off the "Invite to connect" anchor and
 * so goes BLIND once the search pool is mostly already-invited (the "viewed 0 of 40" bug).
 * Both states keep the member componentkey (`…urn:li:member:<id>_connect|_pending`), so we
 * anchor on that, then walk up to the card for the profile link + headline — same structural,
 * jsdom-safe approach as harvestPeople, and the SAME numeric memberId (views:seen stays valid).
 */
export function harvestProfiles(root: ParentNode): PersonCandidate[] {
  const out: PersonCandidate[] = [];
  const seen = new Set<string>();
  for (const el of root.querySelectorAll('[componentkey*="urn:li:member:"]')) {
    const member = (el.getAttribute('componentkey') ?? '').match(/urn:li:member:(\d+)/)?.[1];
    if (!member || seen.has(member)) continue;
    let card: Element | null = el.parentElement;
    while (card && !card.querySelector('a[href*="/in/"]')) card = card.parentElement;
    if (!card) continue;
    const profile = card.querySelector<HTMLAnchorElement>('a[href*="/in/"]');
    const ps = card.querySelectorAll('p');
    seen.add(member);
    out.push({
      memberId: member,
      name: (profile?.textContent ?? '').replace(/\s+/g, ' ').split('•')[0].trim(),
      headline: (ps[1]?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      profileUrl: (profile?.getAttribute('href') ?? '').split('?')[0],
    });
  }
  return out;
}

/**
 * Wait for the current people-search page to render, then harvest it. Results appear a
 * few seconds AFTER the content script is ready, so a single read returns []. Poll until
 * EITHER cards render (`ok`) OR the "No results found" empty-state renders (`empty`,
 * early-exit so a genuinely-empty search stays fast). If neither shows within the budget,
 * report `not_ready` — the page never rendered (slow/failed nav), which is a DIFFERENT bug
 * from an empty search and must be reported as such. Injectable for unit tests.
 *
 * `peopleCount` (optional): count of ALL member cards on the page, connectable or not (i.e.
 * `harvestProfiles(...).length`). The action buttons hydrate a few seconds after the cards,
 * and the member componentkey lives ON the button, so `peopleCount > 0` means "buttons
 * hydrated". When the connectable `harvest()` stays empty but people ARE present, the page is
 * rendered-but-saturated (everyone already Pending) → `none_connectable`, NOT `not_ready`.
 * To avoid a false skip while cards hydrate progressively, we only conclude that once the
 * count has SETTLED (non-zero and unchanged across two polls). Smart Connect passes it;
 * Profile Views omits it (its harvest already counts all people, so `ok` fires instead).
 */
export async function harvestPeoplePage(
  harvest: () => PersonCandidate[],
  sleepMs: (ms: number) => Promise<void>,
  isEmptyState: () => boolean,
  attempts = 40,
  intervalMs = 500,
  peopleCount?: () => number,
): Promise<HarvestResult> {
  let prev = -1;
  let stablePolls = 0;
  // People present and the count no longer growing → hydration finished; if harvest() is
  // still empty here, nobody on the page is connectable (all Pending/already-connected).
  const settledWithoutConnectable = (): boolean => {
    if (!peopleCount) return false;
    const n = peopleCount();
    stablePolls = n > 0 && n === prev ? stablePolls + 1 : 0;
    prev = n;
    return n > 0 && stablePolls >= 2;
  };
  for (let i = 0; i < attempts; i++) {
    const people = harvest();
    if (people.length > 0) return { candidates: people, outcome: 'ok' };
    if (isEmptyState()) return { candidates: [], outcome: 'empty' };
    if (settledWithoutConnectable()) return { candidates: [], outcome: 'none_connectable' };
    await sleepMs(intervalMs);
  }
  const people = harvest();
  if (people.length > 0) return { candidates: people, outcome: 'ok' };
  if (isEmptyState()) return { candidates: [], outcome: 'empty' };
  if (peopleCount && peopleCount() > 0) return { candidates: [], outcome: 'none_connectable' };
  return { candidates: [], outcome: 'not_ready' };
}

/**
 * Harvest across pagination (the people-search list has NO infinite scroll — you switch
 * pages). Wait+harvest each page, accumulate unique candidates (by memberId), then click
 * to the next page; stop at the target, the page cap, or when there's no next page.
 * If the FIRST page is not `ok` (empty search / never rendered) propagate that outcome
 * without paginating — there's nothing to page through, and the reason matters upstream.
 * `harvestPage`/`nextPage` are injected so the loop is unit-testable without a live DOM.
 *
 * `isFresh` (optional): when given, the target counts only FRESH candidates (e.g. profiles
 * not yet viewed). A static search returns the same faces, so without this the loop stalls
 * on page 1 once every card is already-seen; with it, it pages deeper until it has `target`
 * fresh people (or runs out of pages) — the fix for "viewed 3 of 40". Smart Connect omits it
 * (counts all), so its behaviour is unchanged.
 */
export async function harvestPeoplePaginated(
  harvestPage: () => Promise<HarvestResult>,
  nextPage: () => Promise<boolean>,
  opts: { target?: number; maxPages?: number; isFresh?: (c: PersonCandidate) => boolean } = {},
): Promise<HarvestResult> {
  const { target = 30, maxPages = 5, isFresh } = opts;
  const first = await harvestPage();
  if (first.outcome !== 'ok') return first;
  const acc = new Map<string, PersonCandidate>();
  for (const p of first.candidates) acc.set(p.memberId, p);
  const collected = (): number => (isFresh ? [...acc.values()].filter(isFresh).length : acc.size);
  for (let page = 1; page < maxPages; page++) {
    if (collected() >= target) break;
    if (!(await nextPage())) break;
    for (const p of (await harvestPage()).candidates)
      if (!acc.has(p.memberId)) acc.set(p.memberId, p);
  }
  return { candidates: [...acc.values()], outcome: 'ok' };
}

/**
 * Scroll-harvest connectable people from an infinite-scroll surface (PYMK /mynetwork/).
 * Unlike people-search there is NO pagination — cards lazy-load on scroll. Poll harvest(),
 * dedup by memberId, scroll, repeat until `target` unique OR `maxStale` empty rounds. Pure.
 */
export async function pymkScrollHarvest(
  harvest: () => PersonCandidate[],
  scroll: () => Promise<void>,
  sleepMs: () => Promise<void>,
  target: number,
  opts: { maxStale?: number; maxRounds?: number } = {},
): Promise<HarvestResult> {
  const { maxStale = 3, maxRounds = 20 } = opts;
  const acc = new Map<string, PersonCandidate>();
  let stale = 0;
  for (let round = 0; round < maxRounds; round++) {
    const before = acc.size;
    for (const p of harvest()) if (!acc.has(p.memberId)) acc.set(p.memberId, p);
    stale = acc.size > before ? 0 : stale + 1;
    if (acc.size >= target || stale >= maxStale) break;
    await scroll();
    await sleepMs();
  }
  return acc.size > 0
    ? { candidates: [...acc.values()].slice(0, target), outcome: 'ok' }
    : { candidates: [], outcome: 'empty' };
}
