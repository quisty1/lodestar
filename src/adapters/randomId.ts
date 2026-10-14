/** Unique id source for queued actions. Thin edge over crypto.randomUUID. */
export function randomId(): string {
  return crypto.randomUUID();
}
