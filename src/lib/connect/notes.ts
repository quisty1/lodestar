/** Short invite note the user copies. Lodestar still sends the invite without a note. */
export function connectNoteText(args: {
  name: string;
  headline: string;
  expertise: string;
  keywords: string;
}): string {
  const first = args.name.trim().split(/\s+/)[0] || 'there';
  const topic = args.keywords.trim() || args.headline.trim() || 'your work';
  const who = args.expertise.trim() || 'I work in the same field';
  return `Hi ${first} — ${who}. Your background around ${topic} stood out. Open to comparing notes?`;
}

export function noteMonthKey(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}`;
}

export function notesRemaining(used: number, cap: number): number {
  return Math.max(0, cap - used);
}
