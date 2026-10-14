import { describe, expect, it } from 'vitest';
import { LINKEDIN_LOCALE_FIXTURES } from '@/content/__fixtures__/linkedin-locale-fixtures';
import { findCommentSubmit, inspectLinkedInDom } from './domContract';

function root(html: string): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
}

describe('inspectLinkedInDom', () => {
  it.each(LINKEDIN_LOCALE_FIXTURES)(
    'reports structural $locale feed capabilities as ready',
    ({ feed }) => {
      expect(inspectLinkedInDom(root(feed), 'https://www.linkedin.com/feed/')).toMatchObject({
        surface: 'feed',
        capabilities: { feed: 'ready', like: 'ready', comment: 'ready' },
      });
    },
  );

  it('distinguishes an exact empty feed from an unsupported feed DOM', () => {
    expect(
      inspectLinkedInDom(
        root('<main><h2 data-view-name="feed-empty">No posts yet</h2></main>'),
        'https://www.linkedin.com/feed/',
      ).capabilities.feed,
    ).toBe('absent');
    expect(
      inspectLinkedInDom(
        root('<main><article>hydrated, but no supported anchors</article></main>'),
        'https://www.linkedin.com/feed/',
      ).capabilities.feed,
    ).toBe('unsupported_dom');
  });

  it('reports like as unsupported when the reaction control state is unknown', () => {
    const contract = inspectLinkedInDom(
      root(`
      <main>
        <article componentkey="urn:li:activity:unknown-state">
          <a data-view-name="feed-author-name" href="/in/example/">Example</a>
          <button data-view-name="feed-react-button">Localized reaction</button>
          <button data-view-name="feed-comment-button">Localized comment</button>
        </article>
      </main>
    `),
      'https://www.linkedin.com/feed/',
    );

    expect(contract.capabilities).toMatchObject({
      feed: 'ready',
      like: 'unsupported_dom',
      comment: 'ready',
    });
  });

  it.each(LINKEDIN_LOCALE_FIXTURES)(
    'reports structural $locale people results and pagination as ready',
    ({ people }) => {
      expect(
        inspectLinkedInDom(root(people), 'https://www.linkedin.com/search/results/people/'),
      ).toMatchObject({
        surface: 'people_search',
        capabilities: {
          connect: 'ready',
          pagination: 'ready',
          profile: 'ready',
        },
      });
    },
  );

  it.each(LINKEDIN_LOCALE_FIXTURES)(
    'reports exact scoped $locale people empty state as absent',
    ({ emptySearch }) => {
      expect(
        inspectLinkedInDom(root(emptySearch), 'https://www.linkedin.com/search/results/people/')
          .capabilities,
      ).toMatchObject({
        connect: 'absent',
        pagination: 'absent',
        profile: 'absent',
      });
    },
  );

  it('does not infer an empty result from matching prose inside a result card', () => {
    const contract = inspectLinkedInDom(
      root(`
      <main><article data-view-name="people-search-result">
        <a href="/in/example/">Example</a><p>No results found is a common empty-state message.</p>
      </article></main>
    `),
      'https://www.linkedin.com/search/results/people/',
    );

    expect(contract.capabilities.connect).toBe('absent');
    expect(contract.capabilities.profile).toBe('ready');
  });
});

describe('findCommentSubmit', () => {
  it('does not bypass a disabled structural submit with an enabled text sibling', () => {
    const box = root(`
      <div contenteditable="true"></div>
      <button data-view-name="comment-submit" disabled>Опубликовать</button>
      <button>Опубликовать</button>
    `);
    const editor = box.querySelector('[contenteditable="true"]')!;

    expect(findCommentSubmit(editor)).toBeNull();
  });

  it('does not treat an aria-labelled comment opener as the irreversible submit', () => {
    const box = root(`
      <div contenteditable="true"></div>
      <button aria-label="Comment">Comment</button>
    `);

    expect(findCommentSubmit(box.querySelector('[contenteditable="true"]')!)).toBeNull();
  });
});
