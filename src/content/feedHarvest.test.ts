import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedReader } from '@lib/feed/FeedReader';
import type { HumanDelay } from '@lib/engagement/HumanDelay';
import { expandPymkShowAll, feedScroller, harvestByScrolling } from './feedHarvest';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function scrollerBox(id: string, scrollHeight: number, clientHeight: number): HTMLElement {
  const node = document.createElement('div');
  node.id = id;
  node.style.overflowY = 'auto';
  Object.defineProperty(node, 'scrollHeight', { value: scrollHeight });
  Object.defineProperty(node, 'clientHeight', { value: clientHeight });
  return node;
}

describe('feedScroller', () => {
  it('walks up from the composer to the overflowing feed container', () => {
    const scroller = scrollerBox('feed', 500, 100);
    const anchor = document.createElement('div');
    anchor.dataset.testid = 'expandable-text-box';
    scroller.append(anchor);
    document.body.append(scroller);
    expect(feedScroller()).toBe(scroller);
  });

  it('falls back to the document when the feed is empty', () => {
    expect(feedScroller()).toBe(document.scrollingElement ?? document.documentElement);
  });
});

describe('expandPymkShowAll', () => {
  it('returns without waiting when the show-all control is absent', async () => {
    const click = vi.spyOn(HTMLElement.prototype, 'click');
    await expandPymkShowAll();
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });
});

describe('harvestByScrolling', () => {
  it('stops before parsing when the run is already aborted', async () => {
    const parse = vi.fn(() => []);
    const posts = await harvestByScrolling(
      { parse } as unknown as FeedReader,
      {} as HumanDelay,
      10,
      () => true,
    );
    expect(posts).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });
});
