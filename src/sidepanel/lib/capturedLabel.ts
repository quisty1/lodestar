/** Stable "данные от …" label. UTC so a stored ISO instant does not shift with the machine zone. */
export function capturedLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const formatted = new Intl.DateTimeFormat('ru', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
  return `данные от ${formatted}`;
}
