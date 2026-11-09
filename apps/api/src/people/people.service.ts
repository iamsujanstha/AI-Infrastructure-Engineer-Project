import { z } from 'zod';
import type { PeopleQueries, PeopleSecurity, PeopleStore, Person, PolicyAnswerPort, PolicyPassage } from './people.contracts';
import { calendarLeave, canReadEmployee, PeopleError, requireRole } from './people.policy';

const role = z.enum(['admin', 'hr', 'accountant', 'user']);
const email = z.string().trim().toLowerCase().email().max(250);
const password = z.string().min(12).max(128);
const name = z.string().trim().min(1).max(100);
const uuid = z.string().uuid();
const yearSchema = z.coerce.number().int().min(2000).max(2200);
const monthSchema = z.string().regex(/^(20\d\d|21\d\d|2200)-(0[1-9]|1[0-2])$/);
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new PeopleError(400, 'Invalid input. Check required fields, dates, and limits. Passwords must be 12–128 characters.');
  return result.data;
}
function publicPerson(account: Person): Person {
  return { id: account.id, organizationId: account.organizationId, displayName: account.displayName, email: account.email, role: account.role, active: account.active };
}

export class PeopleService {
  constructor(private readonly store: PeopleStore, private readonly security: PeopleSecurity, private readonly references: PolicyAnswerPort,
    private readonly rag?: { ask(actor: Person, input: { question: string; model?: string }, requestId: string): Promise<unknown> }) {}

  async setupStatus(): Promise<{ setupRequired: boolean }> { return { setupRequired: !await this.store.queries.setupExists() }; }

  async setup(input: unknown): Promise<void> {
    const data = parse(z.object({ organizationName: z.string().trim().min(1).max(120), email, displayName: name, password }).strict(), input);
    const passwordHash = await this.security.hashPassword(data.password);
    await this.store.transaction(async (q) => {
      await q.lockSetup();
      if (await q.setupExists()) throw new PeopleError(409, 'This instance has already been set up. Sign in with an existing account.');
      const org = await q.createOrganization(data.organizationName);
      const account = await q.createAccount(org, { ...data, passwordHash, role: 'admin' });
      await q.audit(org, account.id, 'setup.organization', org);
    });
  }

  async login(input: unknown): Promise<{ person: Person; token: string }> {
    const data = parse(z.object({ email, password: z.string().min(1).max(128) }).strict(), input);
    const result = await this.store.transaction(async (q) => {
      const account = await q.loginAccount(data.email);
      const correct = await this.security.verifyPassword(data.password, account?.passwordHash ?? '');
      if (!account || !correct || !account.active || (account.lockedUntil && account.lockedUntil.getTime() > Date.now())) {
        if (account) {
          if (!correct) await q.failedLogin(account.id);
          await q.audit(account.organizationId, account.id, 'session.login', account.id, 'denied');
        }
        return null; // Commit failure counters; throwing inside this transaction would undo them.
      }
      await q.resetLogin(account.id);
      const session = this.security.newSession();
      await q.saveSession(session.hash, account);
      await q.audit(account.organizationId, account.id, 'session.login', account.id);
      return { person: publicPerson(account), token: session.token };
    });
    if (!result) throw new PeopleError(401, 'Unable to sign in. Check credentials or try again later.');
    return result;
  }

  async authenticate(token: string | undefined): Promise<Person> {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new PeopleError(401, 'Sign in to the CMS.');
    const person = await this.store.queries.session(this.security.hashToken(token));
    if (!person) throw new PeopleError(401, 'Your session is invalid or expired. Sign in again.');
    return publicPerson(person);
  }
  async logout(person: Person, token: string): Promise<void> {
    await this.store.transaction(async (q) => {
      await q.revokeSession(this.security.hashToken(token));
      await q.audit(person.organizationId, person.id, 'session.logout', person.id);
    });
  }
  async changePassword(person: Person, input: unknown): Promise<void> {
    const data = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict(), input);
    await this.store.transaction(async (q) => {
      const current = await q.loginAccount(person.email);
      if (!current || !current.active || current.id !== person.id || !await this.security.verifyPassword(data.currentPassword, current.passwordHash)) {
        throw new PeopleError(401, 'Current password is incorrect.');
      }
      await q.changePassword(person.organizationId, person.id, await this.security.hashPassword(data.newPassword));
      await q.audit(person.organizationId, person.id, 'account.password', person.id);
    });
  }
  async employees(person: Person): Promise<Person[]> {
    return this.store.queries.listPeople(person.organizationId, person.role === 'user' ? person.id : null);
  }
  async createAccount(actor: Person, input: unknown): Promise<Person> {
    requireRole(actor, ['admin']);
    const data = parse(z.object({ email, displayName: name, role, password }).strict(), input);
    const passwordHash = await this.security.hashPassword(data.password);
    return this.write(actor, async (q) => {
      const account = await q.createAccount(actor.organizationId, { ...data, passwordHash });
      await q.audit(actor.organizationId, actor.id, 'account.create', account.id);
      return account;
    });
  }
  async updateAccount(actor: Person, target: string, input: unknown): Promise<void> {
    requireRole(actor, ['admin']); parse(uuid, target);
    const data = parse(z.object({ role, active: z.boolean() }).strict(), input);
    if (target === actor.id) throw new PeopleError(409, 'Another admin must change your role or active status.');
    await this.write(actor, async (q) => {
      await this.target(q, actor, target);
      await q.updateAccount(actor.organizationId, target, data.role, data.active);
      await q.audit(actor.organizationId, actor.id, 'account.update_revoke_sessions', target);
    });
  }
  async snapshot(actor: Person, target: string, yearInput: unknown, monthInput: unknown) {
    parse(uuid, target);
    const year = parse(yearSchema, yearInput);
    const month = parse(monthSchema, monthInput);
    const leaveAllowed = canReadEmployee(actor, target, 'leave');
    const salaryAllowed = canReadEmployee(actor, target, 'salary');
    if (!leaveAllowed && !salaryAllowed) return this.deny(actor, 'employee.read', target);
    return this.store.transaction(async (q) => {
      const employee = await this.target(q, actor, target);
      const leave = leaveAllowed ? await q.balance(actor.organizationId, target, year) : null;
      const payroll = salaryAllowed ? await q.payroll(actor.organizationId, target, month) : null;
      const requests = leaveAllowed ? await q.listLeave(actor.organizationId, target, year) : [];
      if (leaveAllowed) await q.audit(actor.organizationId, actor.id, 'leave.read', target);
      if (salaryAllowed) await q.audit(actor.organizationId, actor.id, 'salary.read', target);
      return { employee, leaveAllowed, salaryAllowed, leave, payroll, requests };
    });
  }
  async entitlement(actor: Person, target: string, input: unknown): Promise<void> {
    requireRole(actor, ['admin', 'hr']); parse(uuid, target);
    const data = parse(z.object({ year: yearSchema, days: z.number().int().min(0).max(366) }).strict(), input);
    await this.write(actor, async (q) => {
      await this.target(q, actor, target); await q.lockPerson(actor.organizationId, target);
      const balance = await q.balance(actor.organizationId, target, data.year);
      if (data.days < balance.approvedDays + balance.pendingDays) throw new PeopleError(409, 'Entitlement cannot be lower than approved and pending days.');
      await q.setEntitlement(actor.organizationId, target, data.year, data.days);
      await q.audit(actor.organizationId, actor.id, 'leave.entitlement', target);
    });
  }
  async setPayroll(actor: Person, target: string, input: unknown): Promise<void> {
    requireRole(actor, ['admin', 'accountant']); parse(uuid, target);
    const data = parse(z.object({ month: monthSchema, amountMinor: z.number().int().min(0).max(1e12), currency: z.enum(['NPR', 'USD', 'INR', 'EUR']) }).strict(), input);
    await this.write(actor, async (q) => {
      await this.target(q, actor, target);
      await q.setPayroll(actor.organizationId, target, data);
      await q.audit(actor.organizationId, actor.id, 'salary.write', target);
    });
  }
  async applyLeave(actor: Person, input: unknown) {
    const data = parse(z.object({ startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(1).max(500) }).strict(), input);
    const interval = calendarLeave(data.startDate, data.endDate); parse(yearSchema, interval.year);
    return this.write(actor, async (q) => {
      const balance = await q.balance(actor.organizationId, actor.id, interval.year);
      if (balance.availableDays === null) throw new PeopleError(409, 'HR must configure your leave entitlement for this year first.');
      if (interval.days > balance.availableDays) throw new PeopleError(409, 'Not enough available leave days; pending requests also reserve days.');
      if (await q.overlappingLeave(actor.organizationId, actor.id, data.startDate, data.endDate)) throw new PeopleError(409, 'These dates overlap an existing pending or approved request.');
      const request = await q.createLeave(actor.organizationId, actor.id, { ...data, ...interval });
      await q.audit(actor.organizationId, actor.id, 'leave.apply', request.id);
      return request;
    });
  }
  async leaveQueue(actor: Person, yearInput: unknown) {
    requireRole(actor, ['admin', 'hr']);
    const requests = await this.store.queries.listLeave(actor.organizationId, null, parse(yearSchema, yearInput));
    await this.store.queries.audit(actor.organizationId, actor.id, 'leave.queue', null);
    return requests;
  }
  async decide(actor: Person, id: string, input: unknown): Promise<void> {
    requireRole(actor, ['admin', 'hr']); parse(uuid, id);
    const data = parse(z.object({ status: z.enum(['approved', 'rejected']) }).strict(), input);
    await this.write(actor, async (q) => {
      const request = await q.getLeave(actor.organizationId, id);
      if (!request) throw new PeopleError(404, 'Record not found.');
      if (request.employeeId === actor.id) throw new PeopleError(403, 'You cannot decide your own leave request.');
      await q.lockPerson(actor.organizationId, request.employeeId);
      if (!await q.decideLeave(actor.organizationId, id, actor.id, data.status)) throw new PeopleError(409, 'This request has already been decided.');
      await q.audit(actor.organizationId, actor.id, `leave.${data.status}`, id);
    });
  }
  async documents(actor: Person) { return this.store.queries.documents(actor.organizationId, actor.role,actor.id); }
  async upload(actor: Person, input: unknown): Promise<{ id: string }> {
    requireRole(actor, ['admin']);
    const data = parse(z.object({ title: z.string().trim().min(1).max(160), filename: z.string().regex(/^[A-Za-z0-9_. -]+\.(txt|md)$/i).max(180), audience: z.enum(['all', 'hr', 'accountant', 'admin']), content: z.string().min(1).max(24000) }).strict(), input);
    const passages = this.references.prepare(data.content);
    return this.write(actor, async (q) => {
      const id = await q.createDocument(actor.organizationId, actor.id, { ...data, hash: this.security.hashText(data.content.replace(/\r\n?/g, '\n')), passages });
      await q.audit(actor.organizationId, actor.id, 'document.upload', id);
      return { id };
    });
  }
  async archive(actor: Person, id: string): Promise<void> {
    requireRole(actor, ['admin']); parse(uuid, id);
    await this.write(actor, async (q) => {
      if (!await q.deactivateDocument(actor.organizationId, id)) throw new PeopleError(404, 'Document not found.');
      await q.audit(actor.organizationId, actor.id, 'document.archive', id);
    });
  }
  async audits(actor: Person) { requireRole(actor, ['admin']); return this.store.queries.audits(actor.organizationId); }
  models() { return this.references.models(); }

  async ask(actor: Person, input: unknown, requestId: string) {
    const data = parse(z.object({ topic: z.enum(['salary', 'leave', 'policy']), employeeId: uuid.optional(), year: yearSchema, month: monthSchema, question: z.string().trim().min(1).max(1000), model: z.string().max(250).optional() }).strict(), input);
    const target = data.employeeId ?? actor.id;
    if (data.topic === 'policy' && this.rag) return this.rag.ask(actor, data, requestId);
    if (data.topic !== 'policy') {
      if (!canReadEmployee(actor, target, data.topic)) return this.deny(actor, `assistant.${data.topic}`, target);
      return this.store.transaction(async (q) => {
        const employee = await this.target(q, actor, target);
        await q.audit(actor.organizationId, actor.id, `assistant.${data.topic}`, target);
        if (data.topic === 'salary') {
          const payroll = await q.payroll(actor.organizationId, target, data.month);
          return { kind: 'record', employee, payroll, content: payroll
            ? `${employee.displayName}: recorded salary for ${data.month} is ${new Intl.NumberFormat('en', { style: 'currency', currency: payroll.currency }).format(payroll.amountMinor / 100)}.`
            : `${employee.displayName}: no salary is recorded for ${data.month}.` };
        }
        const b = await q.balance(actor.organizationId, target, data.year);
        return { kind: 'record', employee, leave: b, content: b.configured
          ? `${employee.displayName}, ${b.year}: ${b.entitlementDays} calendar days entitlement; ${b.approvedDays} approved; ${b.pendingDays} pending/reserved; ${b.availableDays} available to apply.`
          : `${employee.displayName}: leave entitlement has not been configured for ${b.year}.` };
      });
    }
    // Policy questions never attach employee records, even when the question requests salary data.
    const words = [...new Set(data.question.toLowerCase().match(/[a-z0-9]+/g) ?? [])].slice(0, 24);
    const found = words.length ? await this.store.queries.findPassages(actor.organizationId, actor.role, words.join(' | ')) : [];
    const candidates: PolicyPassage[] = [];
    let bytes = 0;
    for (const passage of found) {
      const size = new TextEncoder().encode(passage.content).length;
      if (bytes + size > 3000) continue;
      candidates.push(passage); bytes += size;
    }
    await this.store.queries.audit(actor.organizationId, actor.id, 'assistant.policy', null);
    if (!candidates.length) return { kind: 'policy', status: 'not_found', content: 'No supporting passage was found in documents available to your role.', sources: [] };
    if (!data.model) throw new PeopleError(400, 'Select an available local model for policy questions.');
    const result = await this.references.select(data.model, data.question, candidates.map((p, i) => ({ id: `S${i + 1}`, lineStart: p.lineStart, lineEnd: p.lineEnd, text: p.content })), requestId);
    const sources = result.sources.map((source) => {
      const match = /^S(\d+)$/.exec(source.id);
      const passage = match ? candidates[Number(match[1]) - 1] : undefined;
      if (!passage || source.text !== passage.content) throw new PeopleError(502, 'The selected document evidence could not be verified.');
      return passage;
    });
    return { kind: 'policy', status: sources.length ? 'evidence_selected' : 'not_found', content: sources.length ? 'Selected exact policy passages. Check applicability and exceptions.' : 'No supporting passage was selected from permitted documents.', sources, budget: result.budget };
  }
  private async target(q: PeopleQueries, actor: Person, id: string): Promise<Person> {
    const employee = await q.person(actor.organizationId, id);
    if (!employee) throw new PeopleError(404, 'Record not found.');
    return employee;
  }
  private async write<T>(actor: Person, work: (q: PeopleQueries) => Promise<T>): Promise<T> {
    return this.store.transaction(async (q) => {
      await q.lockPerson(actor.organizationId, actor.id);
      const current = await q.person(actor.organizationId, actor.id);
      if (!current?.active || current.role !== actor.role) throw new PeopleError(401, 'Your permissions changed. Sign in again.');
      return work(q);
    });
  }
  private async deny(actor: Person, operation: string, target: string): Promise<never> {
    await this.store.queries.audit(actor.organizationId, actor.id, operation, target, 'denied');
    throw new PeopleError(403, 'You cannot access this employee resource.');
  }
}
