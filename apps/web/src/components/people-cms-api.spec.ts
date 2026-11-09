import { describe, expect, it } from 'vitest';
import { person, snapshot, answer } from './people-cms-api';

describe('CMS browser data contracts', () => {
  const employee = { id: 'fixture', organizationId: 'org', displayName: 'Synthetic', email: 'fixture@example.test', role: 'user', active: true };
  it('keeps unconfigured balances and missing payroll unknown rather than inventing zero', () => {
    const state = snapshot({ employee, leaveAllowed: true, salaryAllowed: true, payroll: null,
      leave: { configured: false, entitlementDays: null, approvedDays: 0, pendingDays: 0, availableDays: null }, requests: [] });
    expect(state.leave?.availableDays).toBeNull(); expect(state.payroll).toBeNull();
  });
  it('rejects unknown roles and malformed source data', () => {
    expect(() => person({ ...employee, role: 'owner' })).toThrow();
    expect(() => answer({ content: 'invalid source', sources: [{ documentId: '1', content: 'x' }] })).toThrow();
    expect(() => snapshot({ employee, leaveAllowed: true, salaryAllowed: true, payroll: { amountMinor: NaN }, requests: [] })).toThrow();
  });
});
