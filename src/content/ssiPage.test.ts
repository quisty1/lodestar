import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SsiSnapshot } from '@lib/types';
import { parseAndReport, parseWhenReady, watchSsiDashboard } from './ssiPage';

const snapshot: SsiSnapshot = {
  total: 70,
  capturedAt: '2026-10-08T10:00:00.000Z',
  pillars: [
    { key: 'brand', label: 'Brand', score: 18 },
    { key: 'people', label: 'People', score: 17 },
    { key: 'insights', label: 'Insights', score: 18 },
    { key: 'relationships', label: 'Relationships', score: 17 },
  ],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

function chromeSend() {
  const sendMessage = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  return sendMessage;
}

describe('parseAndReport', () => {
  it('sends a snapshot when the parser finds SSI', () => {
    const sendMessage = chromeSend();
    parseAndReport({ parse: () => snapshot } as never, { getRoot: () => document.body });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SSI_SNAPSHOT', payload: snapshot });
  });

  it('reports a parser miss', () => {
    const sendMessage = chromeSend();
    parseAndReport({ parse: () => null } as never, { getRoot: () => document.body });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SSI_PARSE_FAILED',
      reason: 'No SSI data on this page',
    });
  });
});

describe('parseWhenReady', () => {
  it('gives up after the numbers never render', async () => {
    vi.useFakeTimers();
    const sendMessage = chromeSend();
    parseWhenReady({ parse: () => null } as never, { getRoot: () => null });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SSI_PARSE_FAILED',
      reason: 'SSI numbers did not render in time',
    });
  });
});

describe('watchSsiDashboard', () => {
  it('polls only on the SSI dashboard', () => {
    vi.useFakeTimers();
    const sendMessage = chromeSend();
    watchSsiDashboard({ parse: () => snapshot } as never, { getRoot: () => document.body });
    expect(sendMessage).not.toHaveBeenCalled();
    window.history.pushState({}, '', '/sales/ssi');
    watchSsiDashboard({ parse: () => snapshot } as never, { getRoot: () => document.body });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SSI_SNAPSHOT', payload: snapshot });
  });
});
