import { documentPermission, documentTitle } from './document-permission';
import type { PoolClient, QueryResultRow } from 'pg';
import type { PostgresService } from '../database/postgres.service';
import { deadlineQuery } from '../database/query-deadline';
import { PgRagQueries, type PolicySql } from './policy-rag.repository';
import type { AuditEvent, DocumentAudience, LeaveBalance, LeaveRequest, LoginAccount, Payroll, PeopleQueries, PeopleRole, PeopleStore, Person, PolicyDocument, PolicyPassage } from './people.contracts';

type Sql = PolicySql;
const PERSON = 'id, organization_id AS "organizationId", email, display_name AS "displayName", role, active';
const LEAVE = `r.id, r.employee_id AS "employeeId", a.display_name AS "employeeName", r.year,
  to_char(r.start_date,'YYYY-MM-DD') AS "startDate", to_char(r.end_date,'YYYY-MM-DD') AS "endDate", r.days, r.reason, r.status`;

class PgPeopleQueries extends PgRagQueries implements PeopleQueries {
  constructor(sql: Sql) { super(sql); }
  async setupExists(): Promise<boolean> { return (await this.sql.query('SELECT 1 FROM people_cms.organizations LIMIT 1')).rowCount === 1; }
  async lockSetup(): Promise<void> { await this.sql.query('SELECT pg_advisory_xact_lock(1279608912, 9)'); }
  async createOrganization(name: string): Promise<string> {
    return (await this.sql.query<{ id: string }>('INSERT INTO people_cms.organizations(name) VALUES($1) RETURNING id', [name])).rows[0]!.id;
  }
  async createAccount(org: string, input: { email: string; displayName: string; role: PeopleRole; passwordHash: string }): Promise<Person> {
    return (await this.sql.query<Person>(`INSERT INTO people_cms.accounts(organization_id,email,display_name,role,password_hash)
      VALUES($1,$2,$3,$4,$5) RETURNING ${PERSON}`, [org, input.email, input.displayName, input.role, input.passwordHash])).rows[0]!;
  }
  async loginAccount(email: string): Promise<LoginAccount | null> {
    return (await this.sql.query<LoginAccount>(`SELECT ${PERSON}, password_hash AS "passwordHash", locked_until AS "lockedUntil"
      FROM people_cms.accounts WHERE email=$1 FOR UPDATE`, [email])).rows[0] ?? null;
  }
  async failedLogin(id: string): Promise<void> {
    await this.sql.query(`UPDATE people_cms.accounts SET failed_logins=failed_logins+1,
      locked_until=CASE WHEN failed_logins+1>=5 THEN clock_timestamp()+interval '15 minutes' ELSE locked_until END WHERE id=$1`, [id]);
  }
  async resetLogin(id: string): Promise<void> { await this.sql.query('UPDATE people_cms.accounts SET failed_logins=0,locked_until=NULL WHERE id=$1', [id]); }
  async saveSession(hash: string, person: Person): Promise<void> {
    await this.sql.query('DELETE FROM people_cms.sessions WHERE expires_at<=clock_timestamp()');
    await this.sql.query(`INSERT INTO people_cms.sessions(token_hash,organization_id,account_id,expires_at)
      VALUES($1,$2,$3,clock_timestamp()+interval '8 hours')`, [hash, person.organizationId, person.id]);
  }
  async session(hash: string): Promise<Person | null> {
    return (await this.sql.query<Person>(`SELECT a.id,a.organization_id AS "organizationId",a.email,a.display_name AS "displayName",a.role,a.active
      FROM people_cms.sessions s JOIN people_cms.accounts a ON a.id=s.account_id AND a.organization_id=s.organization_id
      WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp() AND a.active`, [hash])).rows[0] ?? null;
  }
  async revokeSession(hash: string): Promise<void> { await this.sql.query('DELETE FROM people_cms.sessions WHERE token_hash=$1', [hash]); }
  async rememberOidc(hash: string, verifier: string, nonce: string): Promise<void> {
    await this.sql.query('DELETE FROM people_cms.oidc_attempts WHERE expires_at<=clock_timestamp()');
    await this.sql.query('INSERT INTO people_cms.oidc_attempts(state_hash,verifier,nonce) VALUES($1,$2,$3)', [hash,verifier,nonce]);
  }
  async takeOidc(hash: string): Promise<{ verifier: string; nonce: string } | null> {
    return (await this.sql.query<{ verifier: string; nonce: string }>('DELETE FROM people_cms.oidc_attempts WHERE state_hash=$1 AND expires_at>clock_timestamp() RETURNING verifier,nonce', [hash])).rows[0] ?? null;
  }
  async oidcAccount(issuer: string, subject: string): Promise<Person | null> {
    return (await this.sql.query<Person>(`SELECT ${PERSON} FROM people_cms.accounts WHERE oidc_issuer=$1 AND oidc_subject=$2 AND active FOR UPDATE`, [issuer,subject])).rows[0] ?? null;
  }
  async bindOidc(org: string, employee: string, issuer: string, subject: string): Promise<void> {
    await this.sql.query('UPDATE people_cms.accounts SET oidc_issuer=$3,oidc_subject=$4 WHERE organization_id=$1 AND id=$2', [org,employee,issuer,subject]);
    await this.sql.query('DELETE FROM people_cms.sessions WHERE organization_id=$1 AND account_id=$2', [org,employee]);
  }
  async listPeople(org: string, selfOnly: string | null): Promise<Person[]> {
    return (await this.sql.query<Person>(`SELECT ${PERSON} FROM people_cms.accounts WHERE organization_id=$1
      AND ($2::uuid IS NULL OR id=$2) ORDER BY display_name,id LIMIT 200`, [org, selfOnly])).rows;
  }
  async person(org: string, id: string): Promise<Person | null> {
    return (await this.sql.query<Person>(`SELECT ${PERSON} FROM people_cms.accounts WHERE organization_id=$1 AND id=$2`, [org, id])).rows[0] ?? null;
  }
  async lockPerson(org: string, id: string): Promise<void> {
    await this.sql.query('SELECT id FROM people_cms.accounts WHERE organization_id=$1 AND id=$2 FOR UPDATE', [org, id]);
  }
  async updateAccount(org: string, id: string, role: PeopleRole, active: boolean): Promise<void> {
    await this.sql.query('UPDATE people_cms.accounts SET role=$3,active=$4 WHERE organization_id=$1 AND id=$2', [org, id, role, active]);
    await this.sql.query('DELETE FROM people_cms.sessions WHERE organization_id=$1 AND account_id=$2', [org, id]);
  }
  async changePassword(org: string, id: string, passwordHash: string): Promise<void> {
    await this.sql.query('UPDATE people_cms.accounts SET password_hash=$3 WHERE organization_id=$1 AND id=$2', [org, id, passwordHash]);
    await this.sql.query('DELETE FROM people_cms.sessions WHERE organization_id=$1 AND account_id=$2', [org, id]);
  }
  async balance(org: string, employee: string, year: number): Promise<LeaveBalance> {
    const row = (await this.sql.query<{ entitlement: number | null; approved: number; pending: number }>(`SELECT
      (SELECT entitlement_days FROM people_cms.leave_accounts WHERE organization_id=$1 AND employee_id=$2 AND year=$3)::integer AS entitlement,
      COALESCE(sum(days) FILTER(WHERE status='approved'),0)::integer AS approved,
      COALESCE(sum(days) FILTER(WHERE status='pending'),0)::integer AS pending
      FROM people_cms.leave_requests WHERE organization_id=$1 AND employee_id=$2 AND year=$3`, [org, employee, year])).rows[0]!;
    return { year, configured: row.entitlement !== null, entitlementDays: row.entitlement, approvedDays: row.approved, pendingDays: row.pending, availableDays: row.entitlement === null ? null : row.entitlement - row.approved - row.pending };
  }
  async setEntitlement(org: string, employee: string, year: number, days: number): Promise<void> {
    await this.sql.query(`INSERT INTO people_cms.leave_accounts(organization_id,employee_id,year,entitlement_days) VALUES($1,$2,$3,$4)
      ON CONFLICT(organization_id,employee_id,year) DO UPDATE SET entitlement_days=EXCLUDED.entitlement_days`, [org, employee, year, days]);
  }
  async listLeave(org: string, employee: string | null, year: number): Promise<LeaveRequest[]> {
    return (await this.sql.query<LeaveRequest>(`SELECT ${LEAVE} FROM people_cms.leave_requests r
      JOIN people_cms.accounts a ON a.organization_id=r.organization_id AND a.id=r.employee_id
      WHERE r.organization_id=$1 AND ($2::uuid IS NULL OR r.employee_id=$2) AND r.year=$3
      ORDER BY r.created_at DESC,r.id LIMIT 100`, [org, employee, year])).rows;
  }
  async overlappingLeave(org: string, employee: string, start: string, end: string): Promise<boolean> {
    return (await this.sql.query(`SELECT 1 FROM people_cms.leave_requests WHERE organization_id=$1 AND employee_id=$2
      AND status IN ('pending','approved') AND start_date<=$4::date AND end_date>=$3::date LIMIT 1`, [org, employee, start, end])).rowCount === 1;
  }
  async createLeave(org: string, employee: string, input: { year: number; startDate: string; endDate: string; days: number; reason: string }): Promise<LeaveRequest> {
    const id = (await this.sql.query<{ id: string }>(`INSERT INTO people_cms.leave_requests(organization_id,employee_id,year,start_date,end_date,days,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [org, employee, input.year, input.startDate, input.endDate, input.days, input.reason])).rows[0]!.id;
    return (await this.getLeave(org, id))!;
  }
  async getLeave(org: string, id: string): Promise<LeaveRequest | null> {
    return (await this.sql.query<LeaveRequest>(`SELECT ${LEAVE} FROM people_cms.leave_requests r
      JOIN people_cms.accounts a ON a.organization_id=r.organization_id AND a.id=r.employee_id WHERE r.organization_id=$1 AND r.id=$2`, [org, id])).rows[0] ?? null;
  }
  async decideLeave(org: string, id: string, actor: string, status: 'approved' | 'rejected'): Promise<boolean> {
    return (await this.sql.query(`UPDATE people_cms.leave_requests SET status=$4,decided_by=$3,decided_at=clock_timestamp()
      WHERE organization_id=$1 AND id=$2 AND status='pending'`, [org, id, actor, status])).rowCount === 1;
  }
  async payroll(org: string, employee: string, month: string): Promise<Payroll | null> {
    const row = (await this.sql.query<{ month: string; amountMinor: string; currency: string }>(`SELECT to_char(month,'YYYY-MM') AS month,
      amount_minor::text AS "amountMinor",currency FROM people_cms.payroll WHERE organization_id=$1 AND employee_id=$2 AND month=$3::date`, [org, employee, `${month}-01`])).rows[0];
    return row ? { ...row, amountMinor: Number(row.amountMinor) } : null;
  }
  async setPayroll(org: string, employee: string, input: Payroll): Promise<void> {
    await this.sql.query(`INSERT INTO people_cms.payroll(organization_id,employee_id,month,amount_minor,currency) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(organization_id,employee_id,month) DO UPDATE SET amount_minor=EXCLUDED.amount_minor,currency=EXCLUDED.currency,updated_at=clock_timestamp()`,
    [org, employee, `${input.month}-01`, input.amountMinor, input.currency]);
  }
  async documents(org: string, role: PeopleRole, actorId: string): Promise<PolicyDocument[]> {
    return (await this.sql.query<PolicyDocument>(`SELECT d.id,${documentTitle('d')} AS title,d.filename,CASE WHEN d.record_kind='policy' THEN d.audience ELSE 'Employee '||d.record_kind END AS audience,d.created_at AS "createdAt",d.active FROM people_cms.documents d
      WHERE d.organization_id=$1 AND d.active AND ${documentPermission('d','$2','$3')} ORDER BY d.created_at DESC LIMIT 100`, [org, role,actorId])).rows;
  }
  async createDocument(org: string, actor: string, input: { title: string; filename: string; audience: DocumentAudience; hash: string; passages: { lineStart: number; lineEnd: number; text: string }[] }): Promise<string> {
    const id = (await this.sql.query<{ id: string }>(`INSERT INTO people_cms.documents(organization_id,title,filename,audience,uploaded_by,content_hash)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [org, input.title, input.filename, input.audience, actor, input.hash])).rows[0]!.id;
    for (const [index, passage] of input.passages.entries()) {
      await this.sql.query(`INSERT INTO people_cms.document_passages(organization_id,document_id,ordinal,line_start,line_end,content)
        VALUES($1,$2,$3,$4,$5,$6)`, [org, id, index + 1, passage.lineStart, passage.lineEnd, passage.text]);
    }
    await this.sql.query('UPDATE people_cms.organizations SET policy_revision=policy_revision+1 WHERE id=$1', [org]);
    return id;
  }
  async deactivateDocument(org: string, id: string): Promise<boolean> {
    const changed = (await this.sql.query('UPDATE people_cms.documents SET active=false WHERE organization_id=$1 AND id=$2 AND active', [org, id])).rowCount === 1;
    if (changed) await this.sql.query('UPDATE people_cms.organizations SET policy_revision=policy_revision+1 WHERE id=$1', [org]);
    return changed;
  }
  async findPassages(org: string, role: PeopleRole, query: string): Promise<PolicyPassage[]> {
    // Permission predicates are inside candidate retrieval, not an application post-filter.
    return (await this.sql.query<PolicyPassage>(`SELECT p.document_id AS "documentId",d.title,p.line_start AS "lineStart",p.line_end AS "lineEnd",p.content
      FROM people_cms.document_passages p JOIN people_cms.documents d ON d.organization_id=p.organization_id AND d.id=p.document_id
      WHERE p.organization_id=$1 AND d.active AND d.record_kind='policy' AND (d.audience='all' OR d.audience=$2 OR $2='admin')
      AND to_tsvector('simple',p.content) @@ to_tsquery('simple',$3)
      ORDER BY ts_rank_cd(to_tsvector('simple',p.content),to_tsquery('simple',$3)) DESC,p.document_id,p.ordinal LIMIT 5`, [org, role, query])).rows;
  }
  async audit(org: string, actor: string, operation: string, target: string | null, outcome: 'allowed' | 'denied' = 'allowed'): Promise<void> {
    await this.sql.query('INSERT INTO people_cms.audit_events(organization_id,actor_id,operation,target_id,outcome) VALUES($1,$2,$3,$4,$5)', [org, actor, operation, target, outcome]);
  }
  async audits(org: string): Promise<AuditEvent[]> {
    return (await this.sql.query<AuditEvent>(`SELECT id::text,actor_id AS "actorId",operation,target_id AS "targetId",outcome,created_at AS "createdAt"
      FROM people_cms.audit_events WHERE organization_id=$1 ORDER BY people_cms.audit_events.id DESC LIMIT 100`, [org])).rows;
  }
}

export class PgPeopleStore implements PeopleStore {
  readonly queries: PeopleQueries;
  constructor(private readonly db: PostgresService, private readonly timeoutMs = 5000) {
    this.queries = new PgPeopleQueries({ query: <T extends QueryResultRow>(text: string, values?: unknown[]) => db.query<T>(text, values, timeoutMs) });
  }
  transaction<T>(work: (queries: PeopleQueries) => Promise<T>): Promise<T> {
    return this.db.withTransaction((client: PoolClient) => work(new PgPeopleQueries({
      query: <R extends QueryResultRow>(text: string, values?: unknown[]) => client.query<R>(deadlineQuery(text, values, this.timeoutMs)),
    })), this.timeoutMs);
  }
}
