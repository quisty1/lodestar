import { describe, it, expect, vi } from 'vitest';
import { executeProfileView } from './profileView';

const fastDelay = {
  nextMs: () => 0,
} as unknown as import('../lib/engagement/HumanDelay').HumanDelay;

describe('executeProfileView', () => {
  it('dwells (scrolls) and resolves ok', async () => {
    const scrollTo = vi.fn();
    // jsdom: stub scrollingElement.scrollTo
    Object.defineProperty(document.documentElement, 'scrollTo', {
      value: scrollTo,
      configurable: true,
    });
    const res = await executeProfileView(document, fastDelay);
    expect(res).toEqual({ ok: true });
    expect(scrollTo).toHaveBeenCalled();
  });

  it('stops a long dwell promptly and never performs the later scroll', async () => {
    vi.useFakeTimers();
    try {
      const scrollTo = vi.fn();
      Object.defineProperty(document.documentElement, 'scrollTo', {
        value: scrollTo,
        configurable: true,
      });
      const slowDelay = {
        nextMs: () => 5000,
      } as unknown as import('../lib/engagement/HumanDelay').HumanDelay;
      let stopped = false;

      const result = executeProfileView(document, slowDelay, () => stopped);
      expect(scrollTo).toHaveBeenCalledTimes(1);
      stopped = true;
      await vi.advanceTimersByTimeAsync(100);

      expect(await result).toEqual({ ok: false, reason: 'cancelled' });
      expect(scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
