import { describe, it, expect, beforeEach } from 'vitest';
import { FeedReader } from './FeedReader';
import { LINKEDIN_LOCALE_FIXTURES } from '@/content/__fixtures__/linkedin-locale-fixtures';

// Structure mirrors the LIVE LinkedIn feed (new hashed-class build), validated
// against 8 real posts on 2026-06-24: post root carries `componentkey` (the only
// stable per-post id — no urn in the DOM), author from the control-menu button's
// aria-label, body in [data-testid="expandable-text-box"], like state from the
// reaction button's aria-label. Author/text are neutral placeholders; the
// anchors are real.
const FIXTURE = `
<div componentkey="container-update-list_mainFeed">
  <div componentkey="POST_AAA" class="_52e8c184 efc4bb19">
    <div class="_hdr">
      <button aria-label="Open control menu for post by Jane Recruiter">⋯</button>
      <a href="https://www.linkedin.com/in/jane/?mini=1" aria-label="View Jane Recruiter’s profile">
        <span aria-hidden="true">Jane Recruiter</span>
      </a>
    </div>
    <div data-testid="expandable-text-box">Hiring a senior Vue engineer, remote.<button data-testid="expandable-text-button">…more</button></div>
    <div class="_bar">
      <button aria-label="Reaction button state: no reaction">React</button>
      <button aria-label="Open reactions menu">React menu</button>
      <button aria-label="Comment">Comment</button>
    </div>
  </div>

  <div componentkey="POST_BBB" class="_52e8c184 efc4bb19">
    <div class="_hdr">
      <button aria-label="Open control menu for post by Acme Corp">⋯</button>
      <a href="https://www.linkedin.com/company/acme/" aria-label="View Acme Corp’s page"></a>
    </div>
    <div data-testid="expandable-text-box">We shipped a new TypeScript SDK.</div>
    <div class="_bar">
      <button aria-label="Reaction button state: Like">React</button>
      <button aria-label="Comment">Comment</button>
    </div>
  </div>

  <!-- LinkedIn renders each post twice: a base key and an
       "expanded<base>FeedType_MAIN_FEED_RELEVANCE" variant. -->
  <div componentkey="expandedPOST_AAAFeedType_MAIN_FEED_RELEVANCE" class="_52e8c184 efc4bb19">
    <div class="_hdr"><button aria-label="Open control menu for post by Jane Recruiter">⋯</button></div>
    <div data-testid="expandable-text-box">Hiring a senior Vue engineer, remote.</div>
    <div class="_bar">
      <button aria-label="Reaction button state: no reaction">React</button>
      <button aria-label="Comment">Comment</button>
    </div>
  </div>
</div>`;

describe('FeedReader', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = FIXTURE;
  });

  const reader = new FeedReader();

  it('extracts one FeedPost per real post container', () => {
    const posts = reader.parse(root);
    expect(posts).toHaveLength(2); // AAA + BBB, the duplicate AAA collapsed
  });

  it('reads urn (componentkey), author and text', () => {
    const [a] = reader.parse(root);
    expect(a.urn).toBe('POST_AAA');
    expect(a.authorName).toBe('Jane Recruiter');
    expect(a.text).toBe('Hiring a senior Vue engineer, remote.'); // no "…more" button text
  });

  it('reads the like state from the reaction button (already-liked detection)', () => {
    const [a, b] = reader.parse(root);
    expect(a.alreadyLiked).toBe(false); // "no reaction"
    expect(b.alreadyLiked).toBe(true); // "Like"
  });

  it('deduplicates the base + "expanded" render of a post into one normalised urn', () => {
    const urns = reader.parse(root).map((p) => p.urn);
    expect(urns).toEqual(['POST_AAA', 'POST_BBB']); // expandedPOST_AAA collapsed onto POST_AAA
  });

  it('ignores the outer feed container (many reaction buttons, no author)', () => {
    expect(reader.parse(root).every((p) => p.urn !== 'container-update-list_mainFeed')).toBe(true);
  });

  it('keeps the post root when the structural reaction control has its own componentkey', () => {
    root.innerHTML = `
      <div componentkey="container-update-list_mainFeed">
        <article componentkey="POST_STRUCTURAL">
          <a data-view-name="feed-author-name" href="/in/example/">Example</a>
          <div data-testid="expandable-text-box">Post body</div>
          <button componentkey="ReactionButton" aria-pressed="false">Like</button>
        </article>
      </div>
    `;

    expect(reader.parse(root).map((post) => post.urn)).toEqual(['POST_STRUCTURAL']);
  });

  it('does not promote a single-post feed container to a duplicate post', () => {
    root.innerHTML = `
      <div componentkey="container-update-list_mainFeed">
        <article componentkey="POST_SINGLE">
          <a data-view-name="feed-author-name" href="/in/example/">Example</a>
          <div data-testid="expandable-text-box">Post body</div>
          <button data-view-name="feed-react-button" aria-pressed="false">Like</button>
        </article>
      </div>
    `;

    expect(reader.parse(root).map((post) => post.urn)).toEqual(['POST_SINGLE']);
  });

  it('prefers the stable author view over an earlier profile mention', () => {
    root.innerHTML = `
      <article componentkey="POST_AUTHOR">
        <a href="/in/mentioned/">Mentioned Person</a>
        <a data-view-name="feed-author-name" href="/in/author/">Actual Author</a>
        <div data-testid="expandable-text-box">Post body</div>
        <button data-view-name="feed-react-button" aria-pressed="false">Like</button>
      </article>
    `;

    expect(reader.parse(root)[0]?.authorName).toBe('Actual Author');
  });

  it('honours the limit', () => {
    expect(reader.parse(root, 1)).toHaveLength(1);
  });

  it('returns [] for a root with no posts', () => {
    const empty = document.createElement('div');
    expect(reader.parse(empty)).toEqual([]);
  });

  it('findByUrn locates a post element by its normalised urn', () => {
    const el = reader.findByUrn(root, 'POST_BBB');
    expect(el).not.toBeNull();
    expect(
      el!
        .querySelector('button[aria-label^="Open control menu for post by"]')
        ?.getAttribute('aria-label'),
    ).toContain('Acme Corp');
  });

  it('findByUrn returns null for an unknown urn', () => {
    expect(reader.findByUrn(root, 'POST_ZZZ')).toBeNull();
  });

  it.each(LINKEDIN_LOCALE_FIXTURES)(
    'parses $locale feed through structural anchors, independent of localized labels',
    ({ feed, author, locale }) => {
      root.innerHTML = feed;

      expect(reader.parse(root)).toEqual([
        expect.objectContaining({
          urn: `POST_${locale.toUpperCase()}`,
          authorName: author,
          alreadyLiked: false,
        }),
      ]);
    },
  );
});
