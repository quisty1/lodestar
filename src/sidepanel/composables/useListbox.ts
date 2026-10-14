import { ref } from 'vue';
/** Shared keyboard behaviour for searchable model and country lists. */
export function useListbox(count: () => number, select: (index: number) => void) {
  const open = ref(false);
  const highlighted = ref(-1);
  function show() {
    open.value = true;
    highlighted.value = -1;
  }
  function close() {
    open.value = false;
    highlighted.value = -1;
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const size = count();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open.value = true;
      if (!size) return;
      highlighted.value =
        event.key === 'ArrowDown'
          ? (highlighted.value + 1) % size
          : highlighted.value < 0
            ? size - 1
            : (highlighted.value + size - 1) % size;
    } else if (
      event.key === 'Enter' &&
      open.value &&
      highlighted.value >= 0 &&
      highlighted.value < size
    ) {
      event.preventDefault();
      select(highlighted.value);
    }
  }
  return { open, highlighted, show, close, onKey };
}
