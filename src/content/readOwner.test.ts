import { describe, it, expect, beforeEach } from 'vitest';
import { readOwnerName, waitForOwnerName } from './readOwner';

// Legacy feed chrome captured 2026-06-29: several same-vanity anchors exist and the
// first avatar alt is blank. The reader must scan same-vanity anchors for a clean name.
const SELF_CARD = `
<div id="shareboxProfilePictureComponentRef">
  <a href="https://www.linkedin.com/in/example-owner/"><img alt="" /></a>
</div>
<aside>
  <a href="https://www.linkedin.com/in/example-owner/"><img alt="" /></a>
  <a href="https://www.linkedin.com/in/example-owner/"><img alt="Alex  Morgan " /></a>
  <a href="https://www.linkedin.com/in/example-owner/">Alex MorganTechLead Frontend | Ex-TeamLead</a>
</aside>`;

// Sanitised LIVE RSC self-card captured 2026-08-11. During hydration the background
// image can stay blank while the nested accessible SVG already exposes the owner name.
const RSC_SELF_CARD = `
<div id="shareboxProfilePictureComponentRef">
  <a href="https://www.linkedin.com/in/example-owner/">
    <img alt="" />
    <figure>
      <svg id="person-accent-4" role="img" aria-label="Alex  Morgan "></svg>
    </figure>
  </a>
</div>`;

const STRUCTURED_SELF_CARD = `
<div componentkey="shareboxProfilePictureComponentRef">
  <a href="https://www.linkedin.com/in/example-owner/"><img alt="" /></a>
</div>
<aside>
  <a href="https://www.linkedin.com/in/example-owner/">
    <p><span>Alex Morgan</span></p>
    <p><span>TechLead Frontend | Ex-TeamLead</span></p>
    <p>Chișinău</p>
  </a>
</aside>`;

const FEED_AUTHOR_BEFORE = `
<article>
  <a href="https://www.linkedin.com/in/danil-morozov/"><img alt="Danil Morozov" /></a>
</article>`;

describe('readOwnerName', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
  });

  it('reads the owner display name from the self-card avatar alt (whitespace-normalised)', () => {
    root.innerHTML = SELF_CARD;
    expect(readOwnerName(root)).toBe('Alex Morgan');
  });

  it('reads the owner from an accessible RSC avatar when the image alt is blank', () => {
    root.innerHTML = RSC_SELF_CARD;
    expect(readOwnerName(root)).toBe('Alex Morgan');
  });

  it('reads the first structured name block without concatenating headline or location', () => {
    root.innerHTML = STRUCTURED_SELF_CARD;
    expect(readOwnerName(root)).toBe('Alex Morgan');
  });

  it('ignores same-vanity structured feed text before the owner self-card', () => {
    root.innerHTML = `
      <div id="shareboxProfilePictureComponentRef">
        <a href="https://www.linkedin.com/in/example-owner/"><img alt="" /></a>
      </div>
      <article>
        <a href="https://www.linkedin.com/in/example-owner/">
          <p><span>TechLead notes from the feed</span></p>
        </a>
      </article>
      <aside>
        <a href="https://www.linkedin.com/in/example-owner/">
          <p><span>Alex Morgan</span></p>
          <p><span>TechLead Frontend | Ex-TeamLead</span></p>
        </a>
      </aside>`;
    expect(readOwnerName(root)).toBe('Alex Morgan');
  });

  it('does not treat an unstructured location paragraph as the owner name', () => {
    root.innerHTML = `
      <div id="shareboxProfilePictureComponentRef">
        <a href="https://www.linkedin.com/in/example-owner/"><img alt="" /></a>
      </div>
      <a href="https://www.linkedin.com/in/example-owner/"><p>Chișinău</p></a>`;
    expect(readOwnerName(root)).toBeNull();
  });

  it('prefers the sharebox owner anchor when a feed-author profile link appears first', () => {
    root.innerHTML = FEED_AUTHOR_BEFORE + RSC_SELF_CARD;
    expect(readOwnerName(root)).toBe('Alex Morgan');
  });

  it('uses same-vanity self-card evidence after sharebox establishes the owner', () => {
    root.innerHTML = FEED_AUTHOR_BEFORE + SELF_CARD;
    expect(readOwnerName(root)).toBe('Alex Morgan');
  });

  it('prefers the sharebox owner over an unrelated profile in an earlier aside', () => {
    root.innerHTML = `
      <aside><a href="https://www.linkedin.com/in/danil-morozov/"><img alt="Danil Morozov" /></a></aside>
      ${SELF_CARD}`;
    expect(readOwnerName(root)).toBe('Alex Morgan');
  });

  it('does not trust a single profile link inside an unverified aside', () => {
    root.innerHTML = `
      <aside><a href="https://www.linkedin.com/in/danil-morozov/"><img alt="Danil Morozov" /></a></aside>`;
    expect(readOwnerName(root)).toBeNull();
  });

  it('does not trust a repeated recommendation profile inside an unverified aside', () => {
    root.innerHTML = `
      <aside>
        <a href="https://www.linkedin.com/in/jane-recruiter/"><img alt="Jane Recruiter" /></a>
        <a href="https://www.linkedin.com/in/jane-recruiter/">Jane Recruiter</a>
      </aside>`;
    expect(readOwnerName(root)).toBeNull();
  });

  it('returns null when only a feed-author profile link exists', () => {
    root.innerHTML = FEED_AUTHOR_BEFORE;
    expect(readOwnerName(root)).toBeNull();
  });

  it('does not fall back to a feed author while the present sharebox is still hydrating', () => {
    root.innerHTML = FEED_AUTHOR_BEFORE + '<div id="shareboxProfilePictureComponentRef"></div>';
    expect(readOwnerName(root)).toBeNull();
  });

  it('reads the owner from the sharebox inside the open composer shadow root', () => {
    const host = document.createElement('div');
    host.id = 'interop-outlet';
    host.attachShadow({ mode: 'open' }).innerHTML = RSC_SELF_CARD;
    root.append(host);
    root.insertAdjacentHTML('beforeend', FEED_AUTHOR_BEFORE);

    expect(readOwnerName(root)).toBe('Alex Morgan');
  });

  it('does not treat a shadowed recommendation aside as the owner', () => {
    const host = document.createElement('div');
    host.id = 'interop-outlet';
    host.attachShadow({ mode: 'open' }).innerHTML = `
      <aside>
        <a href="https://www.linkedin.com/in/jane-recruiter/"><img alt="Jane Recruiter" /></a>
      </aside>`;
    root.append(host);

    expect(readOwnerName(root)).toBeNull();
  });

  it('returns null when there is no profile link at all', () => {
    root.innerHTML = '<div>no profile here</div>';
    expect(readOwnerName(root)).toBeNull();
  });

  it('returns null when the self-card avatar has no usable alt', () => {
    root.innerHTML = '<a href="https://www.linkedin.com/in/example-owner/"><img alt="  " /></a>';
    expect(readOwnerName(root)).toBeNull();
  });

  it('retries until the owner identity hydrates', async () => {
    root.innerHTML = `
      <div id="shareboxProfilePictureComponentRef">
        <a href="https://www.linkedin.com/in/example-owner/"><img alt="" /></a>
      </div>`;
    const waits: number[] = [];

    const ownerName = await waitForOwnerName(root, {
      attempts: 3,
      intervalMs: 17,
      wait: async (ms) => {
        waits.push(ms);
        root
          .querySelector('a')
          ?.insertAdjacentHTML(
            'beforeend',
            '<figure><svg role="img" aria-label="Alex  Morgan "></svg></figure>',
          );
      },
    });

    expect(ownerName).toBe('Alex Morgan');
    expect(waits).toEqual([17]);
  });

  it('keeps the default hydration window open beyond five seconds', async () => {
    root.innerHTML = `
      <div id="shareboxProfilePictureComponentRef">
        <a href="https://www.linkedin.com/in/example-owner/"><img alt="" /></a>
      </div>`;
    const waits: number[] = [];

    const ownerName = await waitForOwnerName(root, {
      wait: async (ms) => {
        waits.push(ms);
        if (waits.length === 20) {
          root
            .querySelector('a')
            ?.insertAdjacentHTML(
              'beforeend',
              '<svg role="img" aria-label="Alex Morgan"></svg>',
            );
        }
      },
    });

    expect(ownerName).toBe('Alex Morgan');
    expect(waits).toEqual(Array.from({ length: 20 }, () => 250));
  });

  it('stops after the configured number of attempts when identity stays unavailable', async () => {
    root.innerHTML = '<a href="https://www.linkedin.com/in/example-owner/"><img alt="" /></a>';
    const waits: number[] = [];

    const ownerName = await waitForOwnerName(root, {
      attempts: 3,
      intervalMs: 11,
      wait: async (ms) => {
        waits.push(ms);
      },
    });

    expect(ownerName).toBeNull();
    expect(waits).toEqual([11, 11]);
  });

  it('aborts between retries without reading or waiting again', async () => {
    root.innerHTML = '<a href="https://www.linkedin.com/in/example-owner/"><img alt="" /></a>';
    let aborted = false;
    const waits: number[] = [];

    const ownerName = await waitForOwnerName(root, {
      attempts: 5,
      intervalMs: 13,
      shouldAbort: () => aborted,
      wait: async (ms) => {
        waits.push(ms);
        aborted = true;
      },
    });

    expect(ownerName).toBeNull();
    expect(waits).toEqual([13]);
  });
});
