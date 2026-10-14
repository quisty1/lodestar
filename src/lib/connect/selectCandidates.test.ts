import { describe, it, expect } from 'vitest';
import { selectCandidates } from './selectCandidates';
import type { PersonCandidate } from '../types';

const p = (id: string): PersonCandidate => ({
  memberId: id,
  name: id,
  headline: '',
  profileUrl: '',
});

describe('selectCandidates', () => {
  it('drops already-sent ids and applies the cap', () => {
    const out = selectCandidates([p('1'), p('2'), p('3')], new Set(['2']), 1);
    expect(out.map((c) => c.memberId)).toEqual(['1']);
  });

  it('returns [] when cap is 0 or all are already sent', () => {
    expect(selectCandidates([p('1')], new Set(), 0)).toEqual([]);
    expect(selectCandidates([p('1')], new Set(['1']), 5)).toEqual([]);
  });
});
