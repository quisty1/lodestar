import { describe, expect, it } from 'vitest';
import { prioritizeAuditItems } from './auditPriority';
import type { ProfileAuditItem } from './contracts';

function item(key: string, severity: ProfileAuditItem['severity']): ProfileAuditItem {
  return {
    key,
    label: key,
    category: 'completeness',
    status: 'fail',
    severity,
    basis: 'linkedin',
    evidence: '',
    recommendation: '',
    editUrl: 'https://www.linkedin.com/in/me/',
  };
}

describe('prioritizeAuditItems', () => {
  it('puts high-severity brand gaps before low-severity extras', () => {
    const ordered = prioritizeAuditItems([
      item('projects', 'low'),
      item('headline', 'high'),
      item('photo', 'medium'),
    ]);
    expect(ordered.map((entry) => entry.key)).toEqual(['headline', 'photo', 'projects']);
  });
});
