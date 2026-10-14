import { beforeEach, describe, expect, it } from 'vitest';
import { readProfile } from './readProfile';

const PROFILE_URL = 'https://www.linkedin.com/in/example/?isSelfProfile=true';

function renderFullProfile(): void {
  document.body.innerHTML = `
    <main>
      <section id="top">
        <button componentkey="example_cover_edit_button"></button>
        <img alt="Cover photo" src="cover.jpg">
        <a componentkey="topcard-logo-image-referencekey" href="/in/example/"><img alt="Profile photo" src="me.jpg"></a>
        <a href="/in/example/edit/intro/" aria-label="Edit profile"></a>
        <div id="top-details">
          <div><h2>Example Person</h2></div>
          <p>Senior Frontend Developer | Vue | TypeScript</p>
          <p>Acme · University</p>
          <div><p>Chișinău, Moldova</p><p>·</p></div>
        </div>
        <section data-testid="carousel">
          <li data-testid="carousel-child-container">
            <a href="/in/example/opportunities/job-opportunities/edit/"></a>
            <p><span>Senior Frontend Developer, Frontend Technical Lead roles</span></p>
          </li>
        </section>
      </section>
      <section id="about">
        <a href="/in/example/edit/forms/summary/new/"></a>
        <span data-testid="expandable-text-box">${'Building frontend products and mentoring teams. '.repeat(12)}</span>
      </section>
      <section id="experience">
        <div componentkey="profile_experience_top_anchor_example"></div>
        <a href="/in/example/details/experience/"></a>
        <div componentkey="entity-collection-item-1">
          <a href="/in/example/edit/forms/position/1/"><p>Technical Lead Frontend</p><p>Acme · Full-time</p><p>Jan 2023 - Present</p></a>
          <span data-testid="expandable-text-box">Raised conversion by 25 percent for a confidential product paragraph.</span>
        </div>
        <div componentkey="entity-collection-item-2">
          <a href="/in/example/edit/forms/position/2/"><p>Frontend Developer</p><p>Beta · Full-time</p><p>Jan 2020 - Dec 2022</p></a>
          <span data-testid="expandable-text-box">Built a reusable design system.</span>
        </div>
      </section>
      <section id="education">
        <div componentkey="profile_education_top_anchor_example"></div>
        <a href="/in/example/details/education/edit/forms/10/">University</a>
      </section>
      <section id="skills">
        <div componentkey="profile_skills_top_anchor_example"></div>
        <h2>Skills (12)</h2>
        <div componentkey="com.linkedin.sdui.profile.skill(1)"><p>Vue.js</p></div>
        <div componentkey="com.linkedin.sdui.profile.skill(2)"><p>TypeScript</p></div>
      </section>
      <section><a href="/in/example/details/featured/">Featured</a></section>
      <section><a href="/in/example/details/recommendations/">Recommendations</a></section>
      <section><a href="/in/example/details/projects/">Projects</a></section>
      <aside componentkey="com.linkedin.sdui.profile.card.refExampleSupportedLocales">Public profile & URL</aside>
      <section><a href="/analytics/search-appearances/">1,234 search appearances</a></section>
    </main>
  `;
}

describe('readProfile', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads structural own-profile signals without retaining long profile copy', () => {
    renderFullProfile();

    const snapshot = readProfile(document, PROFILE_URL, '2026-08-15T12:00:00.000Z');

    expect(snapshot).not.toBeNull();
    expect(snapshot).toMatchObject({
      photo: { state: 'known', value: true },
      banner: { state: 'known', value: true },
      headline: { state: 'known', value: { present: true, length: 44 } },
      about: { state: 'known', value: { present: true } },
      location: { state: 'known', value: true },
      currentPosition: { state: 'known', value: { present: true } },
      educationCount: { state: 'known', value: 1 },
      experience: { state: 'known', value: { total: 2, past: 1, described: 2, quantified: 1 } },
      skills: { state: 'known', value: { count: 12 } },
      recommendations: { state: 'known', value: true },
      featured: { state: 'known', value: true },
      projects: { state: 'known', value: true },
      publicUrl: { state: 'known', value: true },
      openToWork: { state: 'known', value: { enabled: true } },
      searchAppearances: { state: 'known', value: 1234 },
    });
    expect(snapshot!.headline.state === 'known' && snapshot!.headline.value.terms).toContain(
      'frontend',
    );
    expect(
      snapshot!.openToWork.state === 'known' && snapshot!.openToWork.value.titleTerms,
    ).toContain('frontend');
    expect(JSON.stringify(snapshot)).not.toContain('confidential product paragraph');
  });

  it('supports localized headings through structural anchors', () => {
    renderFullProfile();
    document.querySelector('#skills h2')!.textContent = 'Навыки (12)';
    document.querySelector(
      '#experience [componentkey^="entity-collection-item"] a p:last-child',
    )!.textContent = 'янв. 2023 г. – настоящее время';

    const snapshot = readProfile(document, PROFILE_URL, '2026-08-15T12:00:00.000Z')!;

    expect(snapshot.skills).toMatchObject({ state: 'known', value: { count: 12 } });
    expect(snapshot.currentPosition).toMatchObject({ state: 'known', value: { present: true } });
  });

  it('returns null when the page cannot prove it is the signed-in user profile', () => {
    renderFullProfile();
    document.querySelector('a[href*="/edit/intro/"]')!.remove();

    expect(
      readProfile(document, 'https://www.linkedin.com/in/other/', '2026-08-15T12:00:00.000Z'),
    ).toBeNull();
  });

  it('waits for a stable lower-page marker instead of auditing the initial top-card shell', () => {
    renderFullProfile();
    document.querySelector('[componentkey*="SupportedLocales"]')!.remove();

    expect(readProfile(document, PROFILE_URL, '2026-08-15T12:00:00.000Z')).toBeNull();
  });

  it('distinguishes absent optional sections from fields not visible on the profile page', () => {
    renderFullProfile();
    document.querySelector('a[href*="/details/featured/"]')!.closest('section')!.remove();
    document.querySelector('a[href*="/details/recommendations/"]')!.closest('section')!.remove();
    document.querySelector('a[href*="/details/projects/"]')!.closest('section')!.remove();

    const snapshot = readProfile(document, PROFILE_URL, '2026-08-15T12:00:00.000Z')!;

    expect(snapshot.featured).toEqual({ state: 'known', value: false });
    expect(snapshot.recommendations).toEqual({ state: 'known', value: false });
    expect(snapshot.projects).toEqual({ state: 'known', value: false });
    expect(snapshot.industry).toEqual({ state: 'unknown' });
  });
});
