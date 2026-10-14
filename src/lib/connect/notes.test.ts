import { describe, expect, it } from 'vitest';
import { connectNoteText, noteMonthKey, notesRemaining } from './notes';

describe('connect notes', () => {
  it('writes a short note from the person and the user expertise', () => {
    const text = connectNoteText({
      name: 'Anna K.',
      headline: 'Tech Recruiter',
      expertise: 'Frontend TechLead',
      keywords: 'Vue',
    });
    expect(text).toContain('Hi Anna');
    expect(text).toContain('Frontend TechLead');
    expect(text).toContain('Vue');
  });

  it('caps the monthly note budget', () => {
    expect(noteMonthKey(new Date(2026, 7, 2))).toBe('2026-08');
    expect(notesRemaining(2, 3)).toBe(1);
    expect(notesRemaining(3, 3)).toBe(0);
  });
});
