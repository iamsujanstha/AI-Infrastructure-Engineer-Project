import type { RagQueries } from './policy-rag.contracts';
import type { OidcQueries } from './oidc.contracts';

export type PeopleRole = 'admin' | 'hr' | 'accountant' | 'user';
export type DocumentAudience = 'all' | 'hr' | 'accountant' | 'admin';
export interface Person {
  id: string; organizationId: string; email: string; displayName: string; role: PeopleRole; active: boolean;
}
export interface LoginAccount extends Person { passwordHash: string; lockedUntil: Date | null }
export interface LeaveBalance { year: number; configured: boolean; entitlementDays: number | null; approvedDays: number; pendingDays: number; availableDays: number | null }
export interface LeaveRequest {
  id: string; employeeId: string; employeeName: string; year: number; startDate: string; endDate: string;
  days: number; reason: string; status: 'pending' | 'approved' | 'rejected';
}
export interface Payroll { month: string; amountMinor: number; currency: string }
export interface PolicyDocument { id: string; title: string; filename: string; audience: DocumentAudience; createdAt: string; active: boolean }
export interface PolicyPassage { documentId: string; title: string; lineStart: number; lineEnd: number; content: string }
export interface AuditEvent { id: string; actorId: string; operation: string; targetId: string | null; outcome: string; createdAt: string }

export interface PeopleQueries extends RagQueries, OidcQueries {
  setupExists(): Promise<boolean>;
  lockSetup(): Promise<void>;
  createOrganization(name: string): Promise<string>;
  createAccount(org: string, input: { email: string; displayName: string; role: PeopleRole; passwordHash: string }): Promise<Person>;
  loginAccount(email: string): Promise<LoginAccount | null>;
  failedLogin(id: string): Promise<void>;
  resetLogin(id: string): Promise<void>;
  saveSession(hash: string, person: Person): Promise<void>;
  session(hash: string): Promise<Person | null>;
  revokeSession(hash: string): Promise<void>;
  listPeople(org: string, selfOnly: string | null): Promise<Person[]>;
  person(org: string, id: string): Promise<Person | null>;
  lockPerson(org: string, id: string): Promise<void>;
  updateAccount(org: string, id: string, role: PeopleRole, active: boolean): Promise<void>;
  changePassword(org: string, id: string, passwordHash: string): Promise<void>;
  balance(org: string, employee: string, year: number): Promise<LeaveBalance>;
  setEntitlement(org: string, employee: string, year: number, days: number): Promise<void>;
  listLeave(org: string, employee: string | null, year: number): Promise<LeaveRequest[]>;
  overlappingLeave(org: string, employee: string, start: string, end: string): Promise<boolean>;
  createLeave(org: string, employee: string, input: { year: number; startDate: string; endDate: string; days: number; reason: string }): Promise<LeaveRequest>;
  getLeave(org: string, id: string): Promise<LeaveRequest | null>;
  decideLeave(org: string, id: string, actor: string, status: 'approved' | 'rejected'): Promise<boolean>;
  payroll(org: string, employee: string, month: string): Promise<Payroll | null>;
  setPayroll(org: string, employee: string, input: Payroll): Promise<void>;
  documents(org: string, role: PeopleRole, actorId: string): Promise<PolicyDocument[]>;
  createDocument(org: string, actor: string, input: { title: string; filename: string; audience: DocumentAudience; hash: string; passages: { lineStart: number; lineEnd: number; text: string }[] }): Promise<string>;
  deactivateDocument(org: string, id: string): Promise<boolean>;
  findPassages(org: string, role: PeopleRole, query: string): Promise<PolicyPassage[]>;
  audit(org: string, actor: string, operation: string, target: string | null, outcome?: 'allowed' | 'denied'): Promise<void>;
  audits(org: string): Promise<AuditEvent[]>;
}
export interface PeopleStore { queries: PeopleQueries; transaction<T>(work: (queries: PeopleQueries) => Promise<T>): Promise<T> }
export interface PeopleSecurity {
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, stored: string): Promise<boolean>;
  newSession(): { token: string; hash: string };
  hashToken(token: string): string;
  hashText(text: string): string;
  hashBytes(bytes: Uint8Array): string;
}
export interface PolicyAnswerPort {
  prepare(text: string): { lineStart: number; lineEnd: number; text: string }[];
  select(model: string, question: string, passages: { id: string; lineStart: number; lineEnd: number; text: string }[], requestId: string): Promise<{ sources: { id: string; text: string }[]; budget: unknown }>;
  models(): Promise<{ models: readonly string[]; defaultModel: string | null }>;
}
