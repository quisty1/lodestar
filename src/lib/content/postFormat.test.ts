import { describe, expect, it } from 'vitest';
import { assessPost } from './postFormat';

describe('assessPost', () => {
  it('requires 900–1200 characters, 3–5 hashtags, no link, and confirmed media', () => {
    const body = `${'a'.repeat(900)}\n#one #two #three`;
    const ok = assessPost(body, true);
    expect(ok.lengthOk).toBe(true);
    expect(ok.hashtagsOk).toBe(true);
    expect(ok.linkInBody).toBe(false);
    expect(ok.mediaAttached).toBe(true);

    const linked = assessPost(`${body} https://example.com`, true);
    expect(linked.linkInBody).toBe(true);
    expect(assessPost('short #one', false).lengthOk).toBe(false);
  });
});
