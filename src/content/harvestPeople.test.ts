// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  harvestPeople,
  harvestProfiles,
  harvestPeoplePage,
  harvestPeoplePaginated,
  pymkScrollHarvest,
} from './harvestPeople';
import {
  findNextPageControl,
  isPeopleSearchEmpty,
  readCurrentPage,
} from '@lib/linkedin/domContract';
import { PEOPLE_SEARCH_HTML } from './__fixtures__/people-search-card';
import { PYMK_CARD_HTML } from './__fixtures__/pymk-card';
import { LINKEDIN_LOCALE_FIXTURES } from './__fixtures__/linkedin-locale-fixtures';
import type { PersonCandidate } from '@lib/types';

describe('harvestPeople (real card HTML boundary)', () => {
  beforeEach(() => {
    document.body.innerHTML = PEOPLE_SEARCH_HTML;
  });

  it('parses connectable cards with memberId, name, headline, profileUrl', () => {
    const people = harvestPeople(document);
    expect(people).toEqual([
      {
        memberId: '1094785181',
        name: 'Olena Diachenko',
        headline: 'Frontend Developer | JavaScript | React | TypeScript',
        profileUrl: 'https://www.linkedin.com/in/olena-diachenko-2a5784266/',
      },
      {
        memberId: '579929146',
        name: 'Predrag Vasic',
        headline: 'Talent Acquisition Specialist | Technical Recruiter | IT Recruiter',
        profileUrl: 'https://www.linkedin.com/in/predrag-vasic-18a273142/',
      },
    ]);
  });

  it('excludes Follow-only people (no Connect anchor)', () => {
    expect(harvestPeople(document).some((p) => p.name === 'Shubh Yadav')).toBe(false);
  });

  // Connect must NOT try to invite an already-pending person (you can't re-invite).
  it('excludes already-Pending people (no Invite anchor)', () => {
    expect(harvestPeople(document).some((p) => p.name === 'Yulia O.')).toBe(false);
  });
});

describe('harvestPeople — PYMK card (button connect control, not anchor)', () => {
  beforeEach(() => {
    document.body.innerHTML = PYMK_CARD_HTML;
  });

  it('parses a PYMK card whose Connect control is a <button>', () => {
    expect(harvestPeople(document)).toEqual([
      {
        memberId: '87274562',
        name: 'Jane Doe',
        headline: 'Talent Acquisition Specialist | Tech Recruiter',
        profileUrl: 'https://www.linkedin.com/in/jane-doe-123/',
      },
    ]);
  });
});

describe('harvestPeople — localized structural controls', () => {
  it.each(LINKEDIN_LOCALE_FIXTURES)(
    'harvests $locale candidate from componentkey without depending on Invite copy',
    ({ people, author, locale }) => {
      document.body.innerHTML = people;

      expect(harvestPeople(document)).toEqual([
        expect.objectContaining({
          memberId: locale === 'en' ? '101' : locale === 'ru' ? '202' : '303',
          name: author,
        }),
      ]);
    },
  );

  it('reads the standard aria-current="page" pagination state', () => {
    document.body.innerHTML = `
      <nav>
        <button data-page-number="1">1</button>
        <button data-page-number="2" aria-current="page">2</button>
      </nav>
    `;

    expect(readCurrentPage(document)).toBe(2);
  });

  it.each(LINKEDIN_LOCALE_FIXTURES)(
    'reads $locale pagination without depending on the English Page prefix',
    ({ people }) => {
      document.body.innerHTML = people;
      expect(readCurrentPage(document)).toBe(1);
      expect(findNextPageControl(document, 1)?.textContent).toBe('2');
    },
  );

  it.each(LINKEDIN_LOCALE_FIXTURES)(
    'recognizes the exact scoped $locale empty state',
    ({ emptySearch }) => {
      document.body.innerHTML = emptySearch;
      expect(isPeopleSearchEmpty(document)).toBe(true);
    },
  );

  it('does not treat matching prose inside a result card as an empty state', () => {
    document.body.innerHTML =
      '<main data-view-name="people-search-results"><article><p>No results found</p></article></main>';
    expect(isPeopleSearchEmpty(document)).toBe(false);
  });

  it('does not treat a connected component state as a connect action', () => {
    document.body.innerHTML = `
      <article>
        <a href="/in/already-connected/">Already Connected</a>
        <p>Already Connected</p><p>Engineer</p>
        <button componentkey="ConnectButtonstate:invitation:urn:li:member:404_connected">Message</button>
      </article>
    `;

    expect(harvestPeople(document)).toEqual([]);
  });
});

// Views' PYMK fallback harvests ALL members (harvestProfiles) off the PYMK page — a NEW
// pairing (harvestProfiles × PYMK button-control card). Pins that it reads the member off
// the componentkey the same way, so a PYMK DOM divergence can't silently no-op the top-up.
describe('harvestProfiles — PYMK card (all-members, for Views fallback)', () => {
  beforeEach(() => {
    document.body.innerHTML = PYMK_CARD_HTML;
  });

  it('captures the PYMK member via componentkey', () => {
    expect(harvestProfiles(document)).toEqual([
      {
        memberId: '87274562',
        name: 'Jane Doe',
        headline: 'Talent Acquisition Specialist | Tech Recruiter',
        profileUrl: 'https://www.linkedin.com/in/jane-doe-123/',
      },
    ]);
  });
});

// Profile Views must visit ANY profile in the results — including people we've already
// invited (now "Pending"). Those lost their Connect anchor but keep the member componentkey,
// so harvestProfiles anchors on that instead. This is THE fix for "viewed 0 of 40": the
// recruiter pool was mostly already-invited, so the Connect-only harvest saw no one.
describe('harvestProfiles (any-status people for Profile Views)', () => {
  beforeEach(() => {
    document.body.innerHTML = PEOPLE_SEARCH_HTML;
  });

  it('captures BOTH connectable and already-Pending people (the views pool)', () => {
    const profiles = harvestProfiles(document);
    expect(profiles).toEqual([
      {
        memberId: '1094785181',
        name: 'Olena Diachenko',
        headline: 'Frontend Developer | JavaScript | React | TypeScript',
        profileUrl: 'https://www.linkedin.com/in/olena-diachenko-2a5784266/',
      },
      {
        memberId: '98425817',
        name: 'Yulia O.',
        headline: 'IT & Tech Talent Acquisition Specialist',
        profileUrl: 'https://www.linkedin.com/in/yuliaobukhova/',
      },
      {
        memberId: '579929146',
        name: 'Predrag Vasic',
        headline: 'Talent Acquisition Specialist | Technical Recruiter | IT Recruiter',
        profileUrl: 'https://www.linkedin.com/in/predrag-vasic-18a273142/',
      },
    ]);
  });

  it('uses the SAME numeric memberId as harvestPeople (views:seen stays valid)', () => {
    const olena = harvestProfiles(document).find((p) => p.name === 'Olena Diachenko');
    expect(olena?.memberId).toBe('1094785181'); // identical to the Connect-anchor harvest
  });
});

const c = (id: string): PersonCandidate => ({
  memberId: id,
  name: id,
  headline: '',
  profileUrl: '',
});
const ok = (candidates: PersonCandidate[]) => ({ candidates, outcome: 'ok' as const });

describe('harvestPeoplePage (wait for the page to render before reading)', () => {
  const never = () => false; // empty-state never appears

  it('polls until cards render, then returns them with outcome ok', async () => {
    let calls = 0;
    const res = await harvestPeoplePage(
      () => (++calls >= 3 ? [c('1')] : []),
      async () => {},
      never,
      16,
      500,
    );
    expect(res).toEqual({ candidates: [c('1')], outcome: 'ok' });
    expect(calls).toBe(3);
  });

  it('exits early as empty the moment the "No results found" state renders', async () => {
    let calls = 0;
    let empty = false;
    const res = await harvestPeoplePage(
      () => {
        calls++;
        return [];
      },
      async () => {
        empty = true;
      }, // empty-state appears after the first wait
      () => empty,
      16,
      10,
    );
    expect(res).toEqual({ candidates: [], outcome: 'empty' });
    // stopped as soon as empty-state showed — did NOT burn all 16 attempts
    expect(calls).toBeLessThan(5);
  });

  it('reports not_ready when neither cards nor empty-state appear in time', async () => {
    let calls = 0;
    const res = await harvestPeoplePage(
      () => {
        calls++;
        return [];
      },
      async () => {},
      never,
      3,
      10,
    );
    expect(res).toEqual({ candidates: [], outcome: 'not_ready' });
    expect(calls).toBe(4); // 3 in-loop + 1 final
  });
});

// The Smart Connect harvest keys off the "Invite … to connect" anchor, so a page whose
// people are ALL already-Pending (invited earlier) parses to zero candidates — but it DID
// render. Reporting that as not_ready ("page never loaded") is a lie that hides a saturated
// pool AND makes runConnectStep bail instead of paging deeper. `peopleCount` (count of ALL
// member cards, incl. Pending — hydrated together with the action buttons) lets the poll tell
// "rendered but nobody connectable" (none_connectable) from "not rendered yet" (not_ready).
describe('harvestPeoplePage — none_connectable (rendered, but everyone is already Pending)', () => {
  const never = () => false;

  it('reports none_connectable once people are present AND the count has settled', async () => {
    // 0 connectable ever; peopleCount holds steady at 10 → hydrated + saturated, not "not_ready"
    const res = await harvestPeoplePage(
      () => [],
      async () => {},
      never,
      40,
      10,
      () => 10,
    );
    expect(res).toEqual({ candidates: [], outcome: 'none_connectable' });
  });

  it('does NOT declare none_connectable mid-hydration — ok wins when a connect anchor hydrates', async () => {
    // cards render first (count 10 @poll1), a connect anchor hydrates a beat later (@poll2).
    // Concluding none_connectable the instant cards appear would false-skip this page.
    let poll = 0;
    const res = await harvestPeoplePage(
      () => (poll >= 2 ? [c('9')] : []),
      async () => {
        poll++;
      },
      never,
      40,
      10,
      () => (poll >= 1 ? 10 : 0),
    );
    expect(res.outcome).toBe('ok');
  });

  it('still reports not_ready when NO people ever render (peopleCount stays 0)', async () => {
    const res = await harvestPeoplePage(
      () => [],
      async () => {},
      never,
      3,
      10,
      () => 0,
    );
    expect(res).toEqual({ candidates: [], outcome: 'not_ready' });
  });

  it('is backward-compatible: without peopleCount, an unrendered page is still not_ready', async () => {
    const res = await harvestPeoplePage(
      () => [],
      async () => {},
      never,
      3,
      10,
    );
    expect(res.outcome).toBe('not_ready');
  });
});

describe('harvestPeoplePaginated (accumulate across pagination)', () => {
  it('harvests each page, dedups by memberId, advances until there is no next page', async () => {
    const pages = [ok([c('1'), c('2')]), ok([c('2'), c('3')]), ok([c('4')])];
    let p = 0;
    const res = await harvestPeoplePaginated(
      async () => pages[p],
      async () => {
        p++;
        return p < pages.length;
      },
      { target: 30, maxPages: 5 },
    );
    expect(res.candidates.map((x) => x.memberId).sort()).toEqual(['1', '2', '3', '4']);
    expect(res.outcome).toBe('ok');
  });

  it('stops at the target without paginating further', async () => {
    let nexts = 0;
    const res = await harvestPeoplePaginated(
      async () => ok([c('1'), c('2'), c('3')]),
      async () => {
        nexts++;
        return true;
      },
      { target: 3, maxPages: 5 },
    );
    expect(res.candidates).toHaveLength(3);
    expect(nexts).toBe(0);
  });

  it('propagates a non-ok first page WITHOUT paginating (empty search = stop)', async () => {
    let nexts = 0;
    const res = await harvestPeoplePaginated(
      async () => ({ candidates: [], outcome: 'empty' as const }),
      async () => {
        nexts++;
        return true;
      },
      { target: 30, maxPages: 5 },
    );
    expect(res).toEqual({ candidates: [], outcome: 'empty' });
    expect(nexts).toBe(0);
  });

  it('propagates not_ready from the first page', async () => {
    const res = await harvestPeoplePaginated(
      async () => ({ candidates: [], outcome: 'not_ready' as const }),
      async () => true,
      { target: 30, maxPages: 3 },
    );
    expect(res.outcome).toBe('not_ready');
  });

  // Profile Views needs FRESH (unseen) people: a static search returns the same faces,
  // so counting total-harvested toward the target stalls at the first page while every
  // candidate is already seen. isFresh makes the target count FRESH, so it pages deeper.
  it('pages past an all-seen page until it has `target` FRESH candidates', async () => {
    const seen = new Set(['1', '2']);
    const pages = [ok([c('1'), c('2')]), ok([c('3'), c('4')])]; // page0 all seen, page1 fresh
    let p = 0;
    let nexts = 0;
    const res = await harvestPeoplePaginated(
      async () => pages[p],
      async () => {
        nexts++;
        p++;
        return p < pages.length;
      },
      { target: 2, maxPages: 5, isFresh: (x) => !seen.has(x.memberId) },
    );
    expect(res.candidates.map((x) => x.memberId).sort()).toEqual(['1', '2', '3', '4']);
    expect(nexts).toBe(1); // advanced past the all-seen page0 to reach the 2 fresh on page1
  });

  it('counts FRESH not total toward the target — does not over-paginate', async () => {
    const seen = new Set<string>(); // everyone fresh
    let nexts = 0;
    const res = await harvestPeoplePaginated(
      async () => ok([c('1'), c('2'), c('3')]),
      async () => {
        nexts++;
        return true;
      },
      { target: 2, maxPages: 5, isFresh: (x) => !seen.has(x.memberId) },
    );
    expect(res.candidates).toHaveLength(3);
    expect(nexts).toBe(0); // 3 fresh on page0 already ≥ target 2
  });
});

describe('pymkScrollHarvest (scroll-load connectable people)', () => {
  it('scrolls until target unique candidates collected', async () => {
    const rounds = [[c('1')], [c('1'), c('2')], [c('2'), c('3')]];
    let r = 0;
    const res = await pymkScrollHarvest(
      () => rounds[Math.min(r, rounds.length - 1)],
      async () => {
        r++;
      },
      async () => {},
      3,
      { maxStale: 3, maxRounds: 10 },
    );
    expect(res.candidates.map((x) => x.memberId).sort()).toEqual(['1', '2', '3']);
    expect(res.outcome).toBe('ok');
  });

  it('reports empty when no cards ever appear', async () => {
    const res = await pymkScrollHarvest(
      () => [],
      async () => {},
      async () => {},
      5,
      { maxStale: 2, maxRounds: 5 },
    );
    expect(res.outcome).toBe('empty');
  });
});
