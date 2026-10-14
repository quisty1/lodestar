export type FixtureLocale = 'en' | 'ru' | 'ro';

interface LocaleFixture {
  locale: FixtureLocale;
  author: string;
  feed: string;
  people: string;
  emptySearch: string;
}

/**
 * PII-sanitized contract fixtures. Hashed classes are intentionally omitted:
 * stable component keys, view names, test ids, hrefs and state attributes are
 * preserved while visible/accessibility copy varies by locale.
 */
export const LINKEDIN_LOCALE_FIXTURES: readonly LocaleFixture[] = [
  {
    locale: 'en',
    author: 'Jane Recruiter',
    feed: `
      <main data-view-name="feed-main">
        <article componentkey="POST_EN">
          <a data-view-name="feed-author-name" href="/in/jane-recruiter/">Jane Recruiter</a>
          <div data-testid="expandable-text-box">Hiring a Vue engineer.</div>
          <button data-view-name="feed-react-button" aria-pressed="false"
            aria-label="Reaction button state: no reaction">Like</button>
          <button data-view-name="feed-comment-button" aria-label="Comment">Comment</button>
        </article>
      </main>`,
    people: `
      <main data-view-name="people-search-results">
        <article data-view-name="people-search-result">
          <a href="/in/jane-recruiter/">Jane Recruiter</a>
          <p>Jane Recruiter</p><p>Technical Recruiter</p>
          <a componentkey="ConnectButtonstate:invitation:urn:li:member:101_connect"
            aria-label="Invite Jane Recruiter to connect">Connect</a>
        </article>
        <nav data-view-name="pagination">
          <button data-page-number="1" aria-current="true" aria-label="Page 1">1</button>
          <button data-page-number="2" aria-label="Page 2">2</button>
        </nav>
      </main>`,
    emptySearch: '<main><h2 data-view-name="search-no-results">No results found</h2></main>',
  },
  {
    locale: 'ru',
    author: 'Ирина Рекрутер',
    feed: `
      <main data-view-name="feed-main">
        <article componentkey="POST_RU">
          <a data-view-name="feed-author-name" href="/in/irina/">Ирина Рекрутер</a>
          <div data-testid="expandable-text-box">Ищем Vue-разработчика.</div>
          <button data-view-name="feed-react-button" aria-pressed="false"
            aria-label="Состояние кнопки реакции: нет реакции">Нравится</button>
          <button data-view-name="feed-comment-button" aria-label="Комментировать">Комментировать</button>
        </article>
      </main>`,
    people: `
      <main data-view-name="people-search-results">
        <article data-view-name="people-search-result">
          <a href="/in/irina/">Ирина Рекрутер</a>
          <p>Ирина Рекрутер</p><p>Технический рекрутер</p>
          <button componentkey="ConnectButtonstate:invitation:urn:li:member:202_connect"
            aria-label="Пригласить пользователя Ирина Рекрутер установить контакт">Установить контакт</button>
        </article>
        <nav data-view-name="pagination">
          <button aria-current="true" aria-label="Страница 1">1</button>
          <button aria-label="Страница 2">2</button>
        </nav>
      </main>`,
    emptySearch: '<main><h2>Результаты не найдены</h2></main>',
  },
  {
    locale: 'ro',
    author: 'Ana Recruiter',
    feed: `
      <main data-view-name="feed-main">
        <article componentkey="POST_RO">
          <a data-view-name="feed-author-name" href="/in/ana/">Ana Recruiter</a>
          <div data-testid="expandable-text-box">Căutăm un dezvoltator Vue.</div>
          <button data-view-name="feed-react-button" aria-pressed="false"
            aria-label="Starea butonului de reacție: nicio reacție">Apreciază</button>
          <button data-view-name="feed-comment-button" aria-label="Comentează">Comentează</button>
        </article>
      </main>`,
    people: `
      <main data-view-name="people-search-results">
        <article data-view-name="people-search-result">
          <a href="/in/ana/">Ana Recruiter</a>
          <p>Ana Recruiter</p><p>Recrutor tehnic</p>
          <a componentkey="ConnectButtonstate:invitation:urn:li:member:303_connect"
            aria-label="Invită pe Ana Recruiter să vă conectați">Conectează-te</a>
        </article>
        <nav data-view-name="pagination">
          <button aria-current="true" aria-label="Pagina 1">1</button>
          <button aria-label="Pagina 2">2</button>
        </nav>
      </main>`,
    emptySearch: '<main><h2>Nu s-au găsit rezultate</h2></main>',
  },
];
