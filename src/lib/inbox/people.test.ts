import { describe, expect, it } from 'vitest';
import { readPeople } from './people';

describe('readPeople', () => {
  it('reads nested first and last names', () => {
    const read = readPeople(
      {
        elements: [
          {
            firstName: 'Anna',
            lastName: 'K.',
            headline: 'Tech Recruiter',
            publicIdentifier: 'anna-k',
          },
        ],
      },
      'viewed',
    );
    expect(read.status).toBe('known');
    expect(read.people[0]).toMatchObject({
      name: 'Anna K.',
      role: 'Tech Recruiter',
      kind: 'viewed',
      profileUrl: 'https://www.linkedin.com/in/anna-k',
    });
  });

  it('treats an explicit empty list as known and a foreign payload as unknown', () => {
    expect(readPeople({ elements: [] }, 'messaged')).toEqual({ status: 'known', people: [] });
    expect(readPeople({ html: '<div>login</div>' }, 'messaged').status).toBe('unknown');
    expect(readPeople(null, 'accepted').status).toBe('unknown');
  });
});
