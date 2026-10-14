import { describe, expect, it, vi } from 'vitest';
import { LINKEDIN_LOCALE_FIXTURES } from './__fixtures__/linkedin-locale-fixtures';
import { executeLike, findSubmit } from './domActions';

describe('localized feed actions', () => {
  it.each(LINKEDIN_LOCALE_FIXTURES)(
    'clicks the $locale unreacted structural control',
    ({ feed, locale }) => {
      document.body.innerHTML = feed;
      const button = document.querySelector<HTMLElement>('[data-view-name="feed-react-button"]')!;
      const click = vi.spyOn(button, 'click');

      expect(executeLike(document, `POST_${locale.toUpperCase()}`)).toEqual({ ok: true });
      expect(click).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['en', 'Comment'],
    ['ru', 'Комментировать'],
    ['ro', 'Comentează'],
  ])('finds the exact scoped %s comment submit', (_locale, label) => {
    const block = document.createElement('div');
    block.innerHTML = `
      <div contenteditable="true" data-editor></div>
      <button>${label}</button>
    `;

    expect(findSubmit(block.querySelector('[data-editor]')!)).toBe(block.querySelector('button'));
  });

  it('prefers a structural submit hook over unrelated localized buttons', () => {
    const block = document.createElement('div');
    block.innerHTML = `
      <div contenteditable="true" data-editor></div>
      <button>Комментировать</button>
      <button data-view-name="comment-submit">Непредвиденный текст</button>
    `;

    expect(findSubmit(block.querySelector('[data-editor]')!)?.getAttribute('data-view-name')).toBe(
      'comment-submit',
    );
  });
});
