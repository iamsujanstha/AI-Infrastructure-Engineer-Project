import type { PeopleRole, Person } from './people.contracts';

export class PeopleError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function requireRole(person: Person, allowed: readonly PeopleRole[]): void {
  if (!allowed.includes(person.role)) throw new PeopleError(403, 'This operation is not permitted for your role.');
}
export function canReadEmployee(person: Person, target: string, resource: 'salary' | 'leave'): boolean {
  return target === person.id || person.role === 'admin' || person.role === 'hr'
    || (resource === 'salary' && person.role === 'accountant');
}
export function calendarLeave(start: string, end: string): { year: number; days: number } {
  const first = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime())
      || first.toISOString().slice(0, 10) !== start || last.toISOString().slice(0, 10) !== end
      || start > end || start.slice(0, 4) !== end.slice(0, 4)) {
    throw new PeopleError(400, 'Use valid dates in the same calendar year, with the end on or after the start.');
  }
  return { year: first.getUTCFullYear(), days: Math.round((last.getTime() - first.getTime()) / 86400000) + 1 };
}
