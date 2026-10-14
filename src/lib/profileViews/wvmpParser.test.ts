import { describe, it, expect } from 'vitest';
import { parseWvmpRsc } from './wvmpParser';
import { WVMP_RSC_FIXTURE } from './fixtures/wvmpFixtures';

// Real, PII-sanitized dump captured live from Vlad's authorized session
// (2026-07-02). This CROSSES the LinkedIn boundary: the parser runs against the
// actual SDUI response shape, not a hand-mocked one.

describe('parseWvmpRsc — SDUI WvmpAnalytics response (real dump)', () => {
  it('extracts the rolling count + window from the real RSC payload', () => {
    expect(parseWvmpRsc(WVMP_RSC_FIXTURE)).toEqual({ count: 45, windowDays: 90 });
  });

  it('ignores distractor numbers, taking the count nearest the anchor', () => {
    // a stray "179" (SDUI colour token) before the real "45" must not win
    const t =
      '"children":["179"] "children":["45"] "children":["Profile viewers in the past 90 days"]';
    expect(parseWvmpRsc(t)).toEqual({ count: 45, windowDays: 90 });
  });

  it('strips thousands separators and honours a different window', () => {
    const t = '"children":["1,234"] "children":["Profile viewers in the past 30 days"]';
    expect(parseWvmpRsc(t)).toEqual({ count: 1234, windowDays: 30 });
  });

  it('returns null when the WVMP anchor is absent (no invented zero)', () => {
    expect(parseWvmpRsc('{"children":["Some other card"]}')).toBeNull();
  });

  it.each([
    ['Просмотров профиля за последние 90 дней', 90],
    ['Vizualizări ale profilului în ultimele 30 de zile', 30],
  ])('parses localized WVMP label %s', (label, windowDays) => {
    const text = `"children":["27"] "children":["${label}"]`;
    expect(parseWvmpRsc(text)).toEqual({ count: 27, windowDays });
  });

  it.each([
    ['1\u00a0234', 'Просмотров профиля за последние 90 дней'],
    ['1.234', 'Vizualizări ale profilului în ultimele 90 de zile'],
  ])('parses locale-formatted integer count %s', (count, label) => {
    expect(parseWvmpRsc(`"children":["${count}"] "children":["${label}"]`)).toEqual({
      count: 1234,
      windowDays: 90,
    });
  });

  it('decodes escaped RSC string tokens before matching localized numbers', () => {
    const text = String.raw`"children":["1\u00a0234"] "children":["Profile viewers in the past 90 days"]`;

    expect(parseWvmpRsc(text)).toEqual({ count: 1234, windowDays: 90 });
  });

  it('does not borrow an unrelated numeric token when the adjacent count is absent', () => {
    const text = [
      '"children":["999"]',
      '"children":["Unrelated card"]',
      '"children":["Profile viewers in the past 90 days"]',
    ].join(' ');

    expect(parseWvmpRsc(text)).toBeNull();
  });
});
