import type { ProfileAuditItem } from './contracts';

/** Brand-completeness items a recruiter sees before anything else. */
const BRAND_ORDER = [
  'photo',
  'banner',
  'headline',
  'about',
  'location',
  'skills',
  'featured',
  'openToWork',
];

const SEVERITY = { high: 0, medium: 1, low: 2 };

/** Fail and warn items: higher severity first, then the brand checklist. */
export function prioritizeAuditItems(items: ProfileAuditItem[]): ProfileAuditItem[] {
  return [...items].sort((a, b) => {
    const severity = SEVERITY[a.severity] - SEVERITY[b.severity];
    if (severity !== 0) return severity;
    return rank(a.key) - rank(b.key);
  });
}

function rank(key: string): number {
  const index = BRAND_ORDER.indexOf(key);
  return index === -1 ? BRAND_ORDER.length : index;
}
