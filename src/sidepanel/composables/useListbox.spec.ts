import { describe, expect, it, vi } from 'vitest';
import { useListbox } from './useListbox';

describe('useListbox', () => {
  it('opens, wraps arrows, selects with Enter, and closes on Escape', () => {
    const select = vi.fn();
    const box = useListbox(() => 2, select);
    box.show();
    expect(box.open.value).toBe(true);
    expect(box.highlighted.value).toBe(-1);

    press(box, 'ArrowDown');
    press(box, 'ArrowDown');
    press(box, 'ArrowDown');
    expect(box.highlighted.value).toBe(0);

    press(box, 'ArrowUp');
    expect(box.highlighted.value).toBe(1);
    press(box, 'Enter');
    expect(select).toHaveBeenCalledWith(1);

    const escape = press(box, 'Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(box.open.value).toBe(false);
  });

  it('does not move the highlight when the list is empty', () => {
    const box = useListbox(() => 0, vi.fn());
    press(box, 'ArrowDown');
    press(box, 'ArrowUp');
    expect(box.open.value).toBe(true);
    expect(box.highlighted.value).toBe(-1);
    press(box, 'Enter');
  });
});

function press(box: ReturnType<typeof useListbox>, key: string) {
  const event = new KeyboardEvent('keydown', { key, cancelable: true });
  box.onKey(event);
  return event;
}
