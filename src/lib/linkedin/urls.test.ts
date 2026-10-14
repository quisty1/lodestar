import { describe, expect, it } from 'vitest';
import {
  LINKEDIN_FEED_URL,
  LINKEDIN_MATCH_PATTERN,
  LINKEDIN_ORIGIN,
  isSupportedLinkedInUrl,
} from './urls';

describe('canonical LinkedIn URL contract', () => {
  it('derives the feed and manifest pattern from one exact origin', () => {
    expect(LINKEDIN_ORIGIN).toBe('https://www.linkedin.com');
    expect(LINKEDIN_MATCH_PATTERN).toBe(`${LINKEDIN_ORIGIN}/*`);
    expect(LINKEDIN_FEED_URL).toBe(`${LINKEDIN_ORIGIN}/feed/`);
  });

  it.each(['https://www.linkedin.com/feed/', 'https://www.linkedin.com/in/me/?locale=ru_RU'])(
    'accepts supported URL %s',
    (url) => {
      expect(isSupportedLinkedInUrl(url)).toBe(true);
    },
  );

  it.each([
    'http://www.linkedin.com/feed/',
    'https://linkedin.com/feed/',
    'https://m.linkedin.com/feed/',
    'https://foo.linkedin.com/feed/',
    'https://www.linkedin.com.evil.test/feed/',
    'not a url',
  ])('rejects unsupported URL %s', (url) => {
    expect(isSupportedLinkedInUrl(url)).toBe(false);
  });
});
