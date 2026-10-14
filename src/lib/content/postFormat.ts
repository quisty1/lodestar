export interface PostFormatReport {
  length: number;
  lengthOk: boolean;
  hashtags: number;
  hashtagsOk: boolean;
  linkInBody: boolean;
  mediaAttached: boolean;
}

const LINK = /https?:\/\/|www\./i;
const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;

/** Reach checks for a LinkedIn post. Media is a user confirmation, not a guess. */
export function assessPost(text: string, mediaAttached = false): PostFormatReport {
  const length = text.trim().length;
  const hashtags = text.match(HASHTAG)?.length ?? 0;
  return {
    length,
    lengthOk: length >= 900 && length <= 1200,
    hashtags,
    hashtagsOk: hashtags >= 3 && hashtags <= 5,
    linkInBody: LINK.test(text),
    mediaAttached,
  };
}
