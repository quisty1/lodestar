import { describe, it, expect } from 'vitest';
import { appendViewHistory, type ViewRecord } from './ViewHistory';

const rec = (id: string, effectId?: string): ViewRecord => ({
  memberId: id,
  name: id,
  headline: '',
  profileUrl: `https://x/${id}`,
  viewedAt: '2026-06-26T00:00:00Z',
  effectId,
});

describe('appendViewHistory', () => {
  it('prepends newest-first and caps', () => {
    const out = appendViewHistory([rec('a')], [rec('b')], 10);
    expect(out.map((r) => r.memberId)).toEqual(['b', 'a']);
  });
  it('tolerates a non-array stored value (chrome.storage gotcha)', () => {
    const out = appendViewHistory({ 0: rec('a') }, [rec('b')], 10);
    expect(out.map((r) => r.memberId)).toEqual(['b', 'a']);
  });
  it('caps to the most recent N', () => {
    const out = appendViewHistory([rec('old')], [rec('n1'), rec('n2')], 2);
    expect(out.map((r) => r.memberId)).toEqual(['n1', 'n2']);
  });

  it('deduplicates effect-backed records without conflating legacy rows', () => {
    const out = appendViewHistory(
      [rec('legacy'), rec('one', 'effect-1')],
      [rec('dup', 'effect-1'), rec('two', 'effect-2')],
    );
    expect(out.map((row) => row.memberId)).toEqual(['two', 'legacy', 'one']);
  });
});
