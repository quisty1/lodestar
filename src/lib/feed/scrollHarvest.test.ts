import { describe, it, expect } from 'vitest';
import { scrollHarvest } from './scrollHarvest';
import type { FeedPost } from '../types';

const post = (urn: string): FeedPost => ({ urn, authorName: 'A', text: 't' });
const noSleep = async () => {};

describe('scrollHarvest', () => {
  it('collects across scroll rounds up to target with NO run active (the manual-harvest fix)', async () => {
    let n = 0;
    const out = await scrollHarvest(3, {
      parse: () => [post(`p${n++}`)], // one fresh post per round
      scrollToBottom: () => {},
      sleep: noSleep,
      // shouldAbort omitted → never-abort. (The bug: it broke on round 0 when no run was active.)
    });
    expect(out.map((p) => p.urn)).toEqual(['p0', 'p1', 'p2']);
  });

  it('aborts immediately (no parse) when shouldAbort is true — run stopped', async () => {
    let parses = 0;
    const out = await scrollHarvest(5, {
      parse: () => {
        parses++;
        return [post('x')];
      },
      scrollToBottom: () => {},
      sleep: noSleep,
      shouldAbort: () => true,
    });
    expect(out).toEqual([]);
    expect(parses).toBe(0);
  });

  it('stops after maxStaleRounds when the feed yields nothing new', async () => {
    let parses = 0;
    const out = await scrollHarvest(10, {
      parse: () => {
        parses++;
        return [];
      },
      scrollToBottom: () => {},
      sleep: noSleep,
    });
    expect(out).toEqual([]);
    expect(parses).toBe(3); // maxStaleRounds
  });

  it('caps the result at target', async () => {
    let n = 0;
    const out = await scrollHarvest(2, {
      parse: () => {
        const r = [post(`a${n}`), post(`b${n}`)];
        n++;
        return r;
      },
      scrollToBottom: () => {},
      sleep: noSleep,
    });
    expect(out).toHaveLength(2);
  });
});
