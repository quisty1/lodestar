import { describe, expect, it } from 'vitest';
import { acceptIncoming } from './acceptIncoming';

function button(label: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.setAttribute('aria-label', label);
  el.textContent = label;
  document.body.append(el);
  return el;
}

describe('acceptIncoming', () => {
  it('clicks named Accept buttons and skips Accept all', async () => {
    document.body.replaceChildren();
    const one = button('Accept invitation from Anna');
    const all = button('Accept all');
    let clicks = 0;
    one.addEventListener('click', () => {
      clicks += 1;
    });
    all.addEventListener('click', () => {
      clicks += 10;
    });

    const result = await acceptIncoming(document, 5, {
      shouldAbort: () => false,
      nextDelay: () => 0,
      sleep: async () => {},
    });

    expect(result.accepted).toBe(1);
    expect(clicks).toBe(1);
  });

  it('stops when the run is cancelled', async () => {
    document.body.replaceChildren();
    button('Принять');
    const result = await acceptIncoming(document, 5, {
      shouldAbort: () => true,
      nextDelay: () => 0,
      sleep: async () => {},
    });
    expect(result).toEqual({ accepted: 0, cancelled: true });
  });
});
