import { describe, expect, it } from 'vitest';
import { calendarLeave, canReadEmployee } from './people.policy';
import type { Person, PeopleRole } from './people.contracts';
import { LocalPeopleSecurity } from './people.security';

describe('people authorization policy', () => {
  const actor = (role: PeopleRole): Person => ({ id: 'self', organizationId: 'org', email: 'test@example.test', displayName: 'Fixture', role, active: true });
  it.each(['admin', 'hr', 'accountant', 'user'] as const)('%s can read their own salary and leave', (role) => {
    expect(canReadEmployee(actor(role), 'self', 'salary')).toBe(true);
    expect(canReadEmployee(actor(role), 'self', 'leave')).toBe(true);
  });
  it.each([
    ['admin', true, true], ['hr', true, true], ['accountant', true, false], ['user', false, false],
  ] as const)('%s cross-employee permissions are explicit', (role, salary, leave) => {
    expect(canReadEmployee(actor(role), 'other', 'salary')).toBe(salary);
    expect(canReadEmployee(actor(role), 'other', 'leave')).toBe(leave);
  });
  it('counts calendar days in UTC including leap days and rejects invalid/cross-year dates', () => {
    expect(calendarLeave('2028-02-28', '2028-03-01')).toEqual({ year: 2028, days: 3 });
    expect(() => calendarLeave('2026-02-30', '2026-03-01')).toThrow();
    expect(() => calendarLeave('2026-12-31', '2027-01-01')).toThrow();
  });
});

describe('local credentials', () => {
  it('uses per-password salts, verifies safely, and stores opaque-session digests', async () => {
    const crypto = new LocalPeopleSecurity();
    const first = await crypto.hashPassword('Synthetic-passphrase-123');
    const second = await crypto.hashPassword('Synthetic-passphrase-123');
    expect(first).not.toBe(second);
    expect(await crypto.verifyPassword('Synthetic-passphrase-123', first)).toBe(true);
    expect(await crypto.verifyPassword('incorrect', first)).toBe(false);
    expect(await crypto.verifyPassword('incorrect', 'malformed')).toBe(false);
    const session = crypto.newSession();
    expect(session.token).toMatch(/^[a-f0-9]{64}$/);
    expect(session.hash).not.toBe(session.token);
    expect(session.hash).toBe(crypto.hashToken(session.token));
  });
});
