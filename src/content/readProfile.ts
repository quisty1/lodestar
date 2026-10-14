import type { Observation, ProfileSnapshot } from '@lib/profile/contracts';
import { isSupportedLinkedInUrl } from '@lib/linkedin/urls';

const CURRENT_POSITION = /\bpresent\b|настоящее\s+время|prezent/i;
const QUANTIFIED = /\d|%|[$€₽£]|\bx\b/i;
const COVER_LABEL = /cover|background|banner|облож|фон|copert|fundal/i;

const known = <T>(value: T): Observation<T> => ({ state: 'known', value });
const unknown = <T>(): Observation<T> => ({ state: 'unknown' });

/** Read only normalized signals from a proven self-profile page. */
export function readProfile(
  root: Document,
  profileUrl: string,
  capturedAt: string,
): ProfileSnapshot | null {
  if (!isSupportedLinkedInUrl(profileUrl)) return null;
  const selfEdit = root.querySelector<HTMLAnchorElement>('a[href*="/edit/intro/"]');
  const logo = root.querySelector<HTMLElement>('[componentkey="topcard-logo-image-referencekey"]');
  const top = selfEdit?.closest('section') ?? logo?.closest('section');
  if (!selfEdit || !logo || !top || !top.contains(selfEdit) || !top.contains(logo)) return null;
  if (!root.querySelector('[componentkey*="SupportedLocales"]')) return null;

  const topCopy = readTopCopy(top);
  const headlineText = topCopy.headline;
  const experience = readExperience(root);
  const about = readAbout(root);
  const skills = readSkills(root);
  const openToWork = readOpenToWork(top);

  return {
    capturedAt,
    profileUrl,
    photo: known(hasProfilePhoto(logo)),
    banner: readBanner(top),
    headline: known({
      present: headlineText.length > 0,
      length: headlineText.length,
      terms: extractTerms(headlineText),
    }),
    about: known({ present: about.length > 0, length: about.length }),
    location: known(topCopy.location.length > 0),
    industry: unknown(),
    currentPosition: known({
      present: experience.currentTitle.length > 0,
      titleTerms: extractTerms(experience.currentTitle),
    }),
    educationCount: known(readEducationCount(root)),
    experience: known({
      total: experience.total,
      past: Math.max(0, experience.total - (experience.currentTitle ? 1 : 0)),
      described: experience.described,
      quantified: experience.quantified,
    }),
    skills: known(skills),
    recommendations: known(hasDetailsSection(root, 'recommendations')),
    featured: known(hasDetailsSection(root, 'featured')),
    projects: known(hasDetailsSection(root, 'projects')),
    publicUrl: known(hasPublicProfileUrl(root, profileUrl)),
    openToWork: known(openToWork),
    searchAppearances: readSearchAppearances(root),
  };
}

function readTopCopy(top: Element): { headline: string; location: string } {
  const heading = top.querySelector('h2');
  let details: Element | null = heading?.parentElement ?? null;
  while (details && details !== top) {
    const directParagraphs = directChildren(details, 'P');
    if (directParagraphs.length >= 2) break;
    details = details.parentElement;
  }
  if (!details) return { headline: '', location: '' };
  const directParagraphs = directChildren(details, 'P');
  const location =
    [...details.children]
      .filter((child) => child.tagName === 'DIV')
      .flatMap((child) => directChildren(child, 'P'))
      .map(text)
      .find((value) => value.length > 1 && value !== '·') ?? '';
  return { headline: text(directParagraphs[0]), location };
}

function hasProfilePhoto(logo: Element): boolean {
  return Boolean(
    logo.matches('img,svg[aria-label]') || logo.querySelector('img,svg[aria-label],[aria-label]'),
  );
}

function readBanner(top: Element): Observation<boolean> {
  const edit = top.querySelector('[componentkey$="_cover_edit_button"]');
  if (!edit) return unknown();
  const media = [...top.querySelectorAll<HTMLElement>('img[alt],svg[aria-label]')].some((element) =>
    COVER_LABEL.test(element.getAttribute('alt') ?? element.getAttribute('aria-label') ?? ''),
  );
  return known(media);
}

function readAbout(root: ParentNode): string {
  const edit = root.querySelector<HTMLAnchorElement>('a[href*="/edit/forms/summary/"]');
  const section = edit?.closest('section');
  return text(section?.querySelector('[data-testid="expandable-text-box"]'));
}

function readExperience(root: ParentNode): {
  total: number;
  described: number;
  quantified: number;
  currentTitle: string;
} {
  const anchor =
    root.querySelector('[componentkey^="profile_experience_top_anchor_"]') ??
    root.querySelector('a[href*="/details/experience/"]');
  const section = anchor?.closest('section');
  if (!section) return { total: 0, described: 0, quantified: 0, currentTitle: '' };
  const items = [
    ...section.querySelectorAll<HTMLElement>('[componentkey^="entity-collection-item"]'),
  ];
  let described = 0;
  let quantified = 0;
  let currentTitle = '';
  for (const item of items) {
    const description = text(item.querySelector('[data-testid="expandable-text-box"]'));
    if (description) described += 1;
    if (description && QUANTIFIED.test(description)) quantified += 1;
    if (!currentTitle && CURRENT_POSITION.test(text(item))) {
      const editLink = item.querySelector<HTMLAnchorElement>('a[href*="/edit/forms/position/"]');
      currentTitle = text(editLink?.querySelector('p'));
    }
  }
  return { total: items.length, described, quantified, currentTitle };
}

function readEducationCount(root: ParentNode): number {
  const anchor =
    root.querySelector('[componentkey^="profile_education_top_anchor_"]') ??
    root.querySelector('a[href*="/details/education/"]');
  const section = anchor?.closest('section');
  if (!section) return 0;
  const ids = new Set(
    [
      ...section.querySelectorAll<HTMLAnchorElement>('a[href*="/details/education/edit/forms/"]'),
    ].map((link) => link.href),
  );
  return ids.size;
}

function readSkills(root: ParentNode): { count: number; terms: string[] } {
  const anchor =
    root.querySelector('[componentkey^="profile_skills_top_anchor_"]') ??
    root.querySelector('a[href*="/details/skills/"]');
  const section = anchor?.closest('section');
  if (!section) return { count: 0, terms: [] };
  const heading =
    [...section.querySelectorAll('h2,h3')].map(text).find((value) => /\([\d\s,.]+\)/.test(value)) ??
    '';
  const count = parseLocalizedInteger(heading.match(/\(([\d\s,.]+)\)/)?.[1] ?? '') ?? 0;
  const terms = [...section.querySelectorAll<HTMLElement>('[componentkey*="profile.skill"]')]
    .map((item) => text(item.querySelector('p,span')))
    .flatMap(extractTerms);
  return { count: Math.max(count, new Set(terms).size), terms: [...new Set(terms)] };
}

function readOpenToWork(top: Element): { enabled: boolean; titleTerms: string[] } {
  const edit = top.querySelector<HTMLAnchorElement>(
    'a[href*="/opportunities/job-opportunities/edit/"]',
  );
  if (!edit) return { enabled: false, titleTerms: [] };
  const card =
    edit.closest('[data-testid="carousel-child-container"]') ??
    edit.closest('li') ??
    edit.parentElement;
  const roleText = card
    ? ([...card.querySelectorAll('p,span')]
        .filter((element) => element.children.length === 0)
        .map(text)
        .sort((left, right) => right.length - left.length)[0] ?? '')
    : '';
  return { enabled: true, titleTerms: extractTerms(roleText) };
}

function readSearchAppearances(root: ParentNode): Observation<number> {
  const link = root.querySelector<HTMLAnchorElement>('a[href*="/analytics/search-appearances"]');
  if (!link) return unknown();
  const value = parseLocalizedInteger(text(link).match(/[\d][\d\s,.]*/)?.[0] ?? '');
  return value === null ? unknown() : known(value);
}

function hasDetailsSection(root: ParentNode, section: string): boolean {
  return Boolean(root.querySelector(`a[href*="/details/${section}/"]`));
}

function hasPublicProfileUrl(root: ParentNode, profileUrl: string): boolean {
  if (!root.querySelector('[componentkey*="SupportedLocales"]')) return false;
  try {
    const parts = new URL(profileUrl).pathname.split('/').filter(Boolean);
    return parts[0] === 'in' && Boolean(parts[1] && parts[1] !== 'me');
  } catch {
    return false;
  }
}

function extractTerms(value: string): string[] {
  const terms = value.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.]{2,}/gu) ?? [];
  return [
    ...new Set(terms.map((term) => term.replace(/[.]+$/, '')).filter((term) => term.length >= 3)),
  ];
}

function parseLocalizedInteger(value: string): number | null {
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function directChildren(parent: Element, tagName: string): Element[] {
  return [...parent.children].filter((child) => child.tagName === tagName);
}

function text(value: Element | null | undefined): string {
  return (value?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
