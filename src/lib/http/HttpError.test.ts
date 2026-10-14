import { describe, it, expect } from 'vitest';
import { HttpError, parseRetryAfterMs } from './HttpError';

describe('HttpError', () => {
  it('is an Error carrying status + optional retryAfterMs', () => {
    const body = '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}';
    const e = new HttpError(429, 'msg', 22000, body);
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(429);
    expect(e.retryAfterMs).toBe(22000);
    expect(e.body).toBe(body);
    expect(e.message).toBe('msg');
  });
});

describe('parseRetryAfterMs', () => {
  it('reads a numeric Retry-After header (seconds → ms)', () => {
    expect(parseRetryAfterMs('30', '')).toBe(30000);
  });

  it("reads Gemini's 'Please retry in Xs' from the FULL body (past the message slice)", () => {
    // real free-tier 429 shape — the hint sits far beyond the first 300 chars
    const body =
      '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-2.5-flash\\nPlease retry in 21.820828702s.","status":"RESOURCE_EXHAUSTED"}}';
    expect(parseRetryAfterMs(null, body)).toBe(21821);
  });

  it('reads a retryDelay field', () => {
    expect(parseRetryAfterMs(null, '"retryDelay": "7s"')).toBe(7000);
  });

  it('returns undefined when no hint is present', () => {
    expect(parseRetryAfterMs(null, 'no hint here')).toBeUndefined();
  });
});
