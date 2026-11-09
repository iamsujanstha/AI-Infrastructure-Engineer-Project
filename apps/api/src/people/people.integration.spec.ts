import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Module, VersioningType, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { json } from 'express';
import { PostgresService } from '../database/postgres.service';
import { runMigrations } from '../database/migration-runner';
import { ChatService } from '../chat/chat.service';
import { SuppliedContextService } from '../chat/supplied-context.service';
import { LocalChatOriginGuard } from '../auth/local-chat-origin.guard';
import type { AppEnvironment } from '../config/environment';
import { PeopleController, PeopleNoStore, PeopleSessionGuard } from './people.http';
import { PgPeopleStore } from './people.repository';
import { LocalPeopleSecurity } from './people.security';
import { PeopleService } from './people.service';
import type { Person } from './people.contracts';
import { PolicyRagService } from './policy-rag.service';
import { PolicyRagController,PolicyUploadGuard } from './policy-rag.http';
import { OrganizationLogin } from './oidc.service';
import type { PolicyCompute } from './policy-rag.contracts';

const databaseUrl = process.env.PEOPLE_TEST_DATABASE_URL;
const values: Record<string, unknown> = {
  NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 4000, LOCAL_CHAT_CONTAINER_MODE: false,
  CORS_ORIGINS: ['http://127.0.0.1:3000'], DATABASE_URL: databaseUrl,
  PG_POOL_MAX: 10, PG_CONNECTION_TIMEOUT_MS: 2000,
  MLX_CONTEXT_WINDOW_TOKENS: 8192, MLX_MAX_OUTPUT_TOKENS: 100,
};
const config = { get: (key: string) => values[key] } as unknown as ConfigService<AppEnvironment, true>;
const complete = vi.fn().mockResolvedValue('{"sourceIds":["S1"]}');
let service: PeopleService;
let rag: PolicyRagService;
const ragConfig={smallModel:'',largeModel:'fixture-model',semanticCache:false};
const fixtureVector=[1,...Array<number>(383).fill(0)];
const compute:PolicyCompute={
  embed:vi.fn(async()=>({profile:'synthetic-test-vectors-not-quality-evidence',vector:fixtureVector})),
  indexPdf:vi.fn(async(bytes)=>({profile:'synthetic-test-vectors-not-quality-evidence',pageCount:1,passages:[{
    ordinal:1,pageNumber:1,lineStart:1,lineEnd:1,embedding:fixtureVector,
    text:Buffer.from(bytes).toString().includes('restricted')?'Restricted orchid policy: HR staff approve special requests.':'Synthetic annual leave policy: permanent staff receive twelve days.',
  }]})),
};

@Module({ controllers: [PeopleController,PolicyRagController], providers: [LocalChatOriginGuard, PeopleSessionGuard, PeopleNoStore,PolicyUploadGuard,
  { provide: ConfigService, useValue: config }, { provide: PeopleService, useFactory: () => service },
  { provide:PolicyRagService,useFactory:()=>rag },
] })
class RealPeopleTestApp {}

describe.skipIf(!databaseUrl)('people CMS (real PostgreSQL + HTTP, synthetic data, fake inference)', () => {
  let app: INestApplication;
  let pool: Pool;
  let database: PostgresService;
  let base: string;
  const people: Record<string, Person> = {};
  const cookies: Record<string, string> = {};
  const pass = 'Synthetic-demo-passphrase-123';
  let firstRequest = '';
  let reservedRequest = '';
  let privateDocument = '';
  const jsonBody = async <T,>(response: Response): Promise<T> => await response.json() as T;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(target.hostname) || !target.pathname.startsWith('/cms_test_')) {
      throw new Error('CMS tests require an explicitly disposable loopback database named cms_test_*.');
    }
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
    await runMigrations(pool, resolve(process.cwd(), 'apps/api/migrations'));
    const secondRun = await runMigrations(pool, resolve(process.cwd(), 'apps/api/migrations'));
    expect(secondRun.applied).toEqual([]);
    // Only the explicitly named disposable database can reach this test reset.
    await pool.query('TRUNCATE people_cms.organizations CASCADE');
    database = new PostgresService(config);
    const chat = new ChatService({ listModels: async () => ['fixture-model'], complete }, config);
    const references = new SuppliedContextService(chat);
    const referencesPort={
      prepare: (text) => references.prepareReference(text),
      select: (model, question, passages, id) => references.selectPrepared(model, question, passages, id), models: () => chat.listModels(),
    } satisfies import('./people.contracts').PolicyAnswerPort;
    rag=new PolicyRagService(new PgPeopleStore(database),new LocalPeopleSecurity(),referencesPort,compute,ragConfig);
    service = new PeopleService(new PgPeopleStore(database), new LocalPeopleSecurity(),referencesPort,rag);
    app = await NestFactory.create(RealPeopleTestApp, { logger: false, bodyParser: false });
    app.use(json({ limit: '64kb' }));
    app.setGlobalPrefix('api'); app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.listen(0, '127.0.0.1'); base = `${await app.getUrl()}/api/v1/cms`;
  }, 30000);
  afterAll(async () => { await app?.close(); await database?.onModuleDestroy(); await pool?.end(); });

  function request(path: string, who = '', method = 'GET', body?: unknown, origin: string | null = 'http://127.0.0.1:3000') {
    return fetch(`${base}${path}`, { method, headers: {
      ...(origin ? { origin } : {}), ...(cookies[who] ? { cookie: cookies[who] } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async function login(who: string) {
    const response = await request('/login', '', 'POST', { email: `${who}@example.test`, password: pass });
    expect(response.status).toBe(201);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict');
    cookies[who] = cookie.split(';')[0]!;
    const body = await jsonBody<{ person: Person }>(response);
    expect(JSON.stringify(body)).not.toContain('passwordHash'); people[who] = body.person;
  }
  const ask = (who: string, topic: string, employeeId: string) => request('/assistant', who, 'POST', {
    topic, employeeId, year: 2026, month: '2026-11', question: 'Show the recorded value.',
  });

  it('starts unauthenticated, serializes first-admin setup, and never creates a default password', async () => {
    expect((await request('/employees')).status).toBe(401);
    expect((await request('/setup', '', 'GET', undefined, null)).status).toBe(403);
    expect((await request('/setup', '', 'POST', { organizationName: 'Synthetic CMS Test', email: 'admin@example.test', displayName: 'Admin Fixture', password: pass })).status).toBe(201);
    expect((await request('/setup', '', 'POST', { organizationName: 'Second', email: 'other@example.test', displayName: 'Other', password: pass })).status).toBe(409);
    await login('admin');
  });
  it('creates role accounts only as admin and stores session digests', async () => {
    for (const [who, role] of [['alice', 'user'], ['bob', 'user'], ['hr', 'hr'], ['accountant', 'accountant']] as const) {
      const response = await request('/employees', 'admin', 'POST', { email: `${who}@example.test`, displayName: `${who} Fixture`, role, password: pass });
      expect(response.status).toBe(201); people[who] = await jsonBody<Person>(response); await login(who);
    }
    const denied = await request('/employees', 'alice', 'POST', { email: 'hacker@example.test', displayName: 'Forged', role: 'admin', password: pass });
    expect(denied.status).toBe(403);
    const token = cookies.alice!.split('=')[1]!;
    expect((await pool.query('SELECT 1 FROM people_cms.sessions WHERE token_hash=$1', [token])).rowCount).toBe(0);
    expect((await request('/session', 'alice')).headers.get('cache-control')).toBe('no-store');
  });
  it('enforces salary writes and self-only user access before data/model exposure', async () => {
    for (const [who, amountMinor] of [['alice', 120000], ['bob', 230000]] as const) {
      expect((await request(`/employees/${people[who]!.id}/payroll`, 'accountant', 'PUT', { month: '2026-11', amountMinor, currency: 'USD' })).status).toBe(200);
    }
    expect((await request(`/employees/${people.bob!.id}/payroll`, 'hr', 'PUT', { month: '2026-11', amountMinor: 1, currency: 'USD' })).status).toBe(403);
    const own = await jsonBody<{ payroll: { amountMinor: number } }>(await ask('alice', 'salary', people.alice!.id));
    expect(own.payroll.amountMinor).toBe(120000);
    const before = complete.mock.calls.length;
    expect((await ask('alice', 'salary', people.bob!.id)).status).toBe(403);
    expect((await request(`/employees/${people.bob!.id}/records?year=2026&month=2026-11`, 'alice')).status).toBe(403);
    expect(complete.mock.calls.length).toBe(before);
    for (const who of ['admin', 'hr', 'accountant']) {
      expect((await ask(who, 'salary', people.bob!.id)).status).toBe(201);
    }
    const visible = await jsonBody<Person[]>(await request('/employees', 'alice'));
    expect(visible.map((person) => person.id)).toEqual([people.alice!.id]);
    expect((await request('/assistant', 'alice', 'POST', { topic: 'salary', employeeId: people.alice!.id, organizationId: 'forged', role: 'admin', year: 2026, month: '2026-11', question: 'pay' })).status).toBe(400);
  });
  it('does not invent unknown salary or entitlement, and excludes leave from accountant cross-employee reads', async () => {
    const unknown = await jsonBody<{ leave: { entitlementDays: null }; payroll: null }>(await request(`/employees/${people.hr!.id}/records?year=2026&month=2026-11`, 'hr'));
    expect(unknown.leave.entitlementDays).toBeNull(); expect(unknown.payroll).toBeNull();
    const accountant = await jsonBody<{ leave: null; leaveAllowed: boolean; payroll: unknown }>(await request(`/employees/${people.alice!.id}/records?year=2026&month=2026-11`, 'accountant'));
    expect(accountant.leaveAllowed).toBe(false); expect(accountant.leave).toBeNull(); expect(accountant.payroll).not.toBeNull();
    expect((await ask('accountant', 'leave', people.alice!.id)).status).toBe(403);
  });
  it('reserves pending days, rejects overlaps, and serializes concurrent balance checks', async () => {
    expect((await request('/leave', 'alice', 'POST', { employeeId: people.bob!.id, startDate: '2026-12-01', endDate: '2026-12-03', reason: 'Forged owner' })).status).toBe(400);
    expect((await request(`/employees/${people.alice!.id}/entitlement`, 'hr', 'PUT', { year: 2026, days: 10 })).status).toBe(200);
    const first = await request('/leave', 'alice', 'POST', { startDate: '2026-12-01', endDate: '2026-12-03', reason: 'Synthetic request' });
    expect(first.status).toBe(201); firstRequest = (await jsonBody<{ id: string }>(first)).id;
    expect((await request('/leave', 'alice', 'POST', { startDate: '2026-12-02', endDate: '2026-12-02', reason: 'Overlap' })).status).toBe(409);
    const races = await Promise.all([
      request('/leave', 'alice', 'POST', { startDate: '2026-12-10', endDate: '2026-12-14', reason: 'Race A' }),
      request('/leave', 'alice', 'POST', { startDate: '2026-12-20', endDate: '2026-12-24', reason: 'Race B' }),
    ]);
    expect(races.map((response) => response.status).sort()).toEqual([201, 409]);
    reservedRequest = (await jsonBody<{ id: string }>(races.find((response) => response.status === 201)!)).id;
    const state = await jsonBody<{ leave: { availableDays: number; pendingDays: number } }>(await request(`/employees/${people.alice!.id}/records?year=2026&month=2026-11`, 'alice'));
    expect(state.leave).toMatchObject({ availableDays: 2, pendingDays: 8 });
    expect((await request(`/employees/${people.alice!.id}/entitlement`, 'hr', 'PUT', { year: 2026, days: 7 })).status).toBe(409);
  });
  it('restricts leave decisions, rejects duplicate decisions and self-approval, and releases rejected reservations', async () => {
    expect((await request('/leave?year=2026', 'accountant')).status).toBe(403);
    expect((await request(`/leave/${firstRequest}`, 'alice', 'PUT', { status: 'approved' })).status).toBe(403);
    expect((await request(`/leave/${firstRequest}`, 'hr', 'PUT', { status: 'approved' })).status).toBe(200);
    expect((await request(`/leave/${firstRequest}`, 'hr', 'PUT', { status: 'approved' })).status).toBe(409);
    expect((await request(`/leave/${reservedRequest}`, 'admin', 'PUT', { status: 'rejected' })).status).toBe(200);
    await request(`/employees/${people.hr!.id}/entitlement`, 'admin', 'PUT', { year: 2026, days: 10 });
    const own = await jsonBody<{ id: string }>(await request('/leave', 'hr', 'POST', { startDate: '2026-12-01', endDate: '2026-12-01', reason: 'HR self request' }));
    expect((await request(`/leave/${own.id}`, 'hr', 'PUT', { status: 'approved' })).status).toBe(403);
    const state = await jsonBody<{ leave: { availableDays: number; approvedDays: number } }>(await request(`/employees/${people.alice!.id}/records?year=2026&month=2026-11`, 'alice'));
    expect(state.leave).toMatchObject({ availableDays: 7, approvedDays: 3 });
  });
  it('filters document candidates in SQL before inference and blocks non-admin upload', async () => {
    const privateInput = { title: 'Synthetic HR orchid rule', filename: 'hr.txt', audience: 'hr', content: 'Synthetic orchid badges require HR approval.' };
    expect((await request('/documents', 'alice', 'POST', privateInput)).status).toBe(403);
    const uploaded = await request('/documents', 'admin', 'POST', privateInput);
    expect(uploaded.status).toBe(201); privateDocument = (await jsonBody<{ id: string }>(uploaded)).id;
    expect((await request('/documents', 'admin', 'POST', { ...privateInput, filename: 'file.pdf' })).status).toBe(400);
    expect((await request('/documents', 'admin', 'POST', { ...privateInput, content: 'password=synthetic-secret' })).status).toBe(400);
    const query = { topic: 'policy', year: 2026, month: '2026-11', question: 'orchid', model: 'fixture-model' };
    const before = complete.mock.calls.length;
    const denied = await jsonBody<{ status: string; sources: unknown[] }>(await request('/assistant', 'alice', 'POST', query));
    expect(denied).toMatchObject({ status: 'not_found', sources: [] }); expect(complete.mock.calls.length).toBe(before);
    const allowed = await jsonBody<{ sources: { documentId: string }[] }>(await request('/assistant', 'hr', 'POST', query));
    expect(allowed.sources[0]?.documentId).toBe(privateDocument);
    const listed = await jsonBody<{ id: string }[]>(await request('/documents', 'alice'));
    expect(listed.map((d) => d.id)).not.toContain(privateDocument);
    await request(`/documents/${privateDocument}/archive`, 'admin', 'POST', {});
    const archived = await jsonBody<{ status: string }>(await request('/assistant', 'hr', 'POST', query));
    expect(archived.status).toBe('not_found');
  });
  it('locks repeated failed login attempts, supports password changes, and revokes role-changed sessions', async () => {
    for (let i = 0; i < 5; i++) expect((await request('/login', '', 'POST', { email: 'bob@example.test', password: 'wrong' })).status).toBe(401);
    expect((await request('/login', '', 'POST', { email: 'bob@example.test', password: pass })).status).toBe(401);
    await request(`/employees/${people.bob!.id}`, 'admin', 'PUT', { role: 'user', active: false });
    expect((await request('/session', 'bob')).status).toBe(401);
    await request(`/employees/${people.alice!.id}`, 'admin', 'PUT', { role: 'hr', active: true });
    expect((await request('/session', 'alice')).status).toBe(401);
    await login('alice'); expect(people.alice!.role).toBe('hr');
    expect((await request('/password', 'alice', 'POST', { currentPassword: pass, newPassword: 'New-synthetic-password-123' })).status).toBe(201);
    expect((await request('/session', 'alice')).status).toBe(401);
    expect((await request(`/employees/${people.admin!.id}`, 'admin', 'PUT', { role: 'user', active: false })).status).toBe(409);
  },20000);
  it('keeps audit decisions without salary values or passwords and denies audit to ordinary users', async () => {
    expect((await request('/audit', 'accountant')).status).toBe(403);
    const audit = await jsonBody<{ outcome: string; operation: string }[]>(await request('/audit', 'admin'));
    expect(audit.some((event) => event.outcome === 'denied')).toBe(true);
    expect(audit.some((event) => event.operation === 'salary.write')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(pass);
    expect(JSON.stringify(audit)).not.toContain('amountMinor');
  });
  it('enforces organization composite references and bounds database read waits', async () => {
    await expect(pool.query(`INSERT INTO people_cms.payroll(organization_id,employee_id,month,amount_minor,currency)
      VALUES(gen_random_uuid(),$1,'2026-11-01',1,'USD')`, [people.admin!.id])).rejects.toMatchObject({ code: '23503' });
    const start = Date.now();
    await expect(database.query('SELECT pg_sleep(0.25)', undefined, 40)).rejects.toThrow('Query read timeout');
    expect(Date.now() - start).toBeLessThan(1500);
    await expect(database.query('SELECT 1 AS recovered', undefined, 1000)).resolves.toMatchObject({ rows: [{ recovered: 1 }] });
  });
  it('publishes vectors atomically, filters private PDFs before ranking, and validates cache scope/revocation',async()=>{
    const added=await request('/employees','admin','POST',{email:'raguser@example.test',displayName:'RAG User Fixture',role:'user',password:pass});
    people.raguser=await jsonBody<Person>(added);await login('raguser');
    async function upload(who:string,filename:string,content:string,audience:string){
      const form=new FormData();form.append('file',new Blob([content],{type:'application/pdf'}),filename);form.append('audience',audience);
      return fetch(`${base}/documents/pdf`,{method:'POST',headers:{origin:'http://127.0.0.1:3000',cookie:cookies[who]!},body:form});
    }
    const before=vi.mocked(compute.indexPdf).mock.calls.length;
    expect((await upload('raguser','no.pdf','%PDF-synthetic','all')).status).toBe(403);
    expect(vi.mocked(compute.indexPdf).mock.calls.length).toBe(before);
    const publicPdf=await upload('admin','public.pdf','%PDF-synthetic-public','all');expect(publicPdf.status).toBe(201);
    const publicId=(await jsonBody<{id:string}>(publicPdf)).id;
    expect((await jsonBody<{id:string}>(await upload('admin','public.pdf','%PDF-synthetic-public','all'))).id).toBe(publicId);
    expect((await upload('admin','private.pdf','%PDF-synthetic-restricted','hr')).status).toBe(201);
    const query={topic:'policy',year:2026,month:'2026-11',question:'Can staff take annual leave?'};
    const first=await jsonBody<{cache:string;sources:{documentId:string}[]}>(await request('/assistant','raguser','POST',query));
    expect(first.cache).toBe('miss');expect(first.sources.map(p=>p.documentId)).toContain(publicId);
    const modelInput=JSON.parse(String(complete.mock.calls.at(-1)?.[0].messages[1].content)) as {sources:{text:string}[]};
    expect(modelInput.sources.some(p=>p.text.includes('Restricted orchid'))).toBe(false);
    const calls=complete.mock.calls.length;
    expect((await jsonBody<{cache:string}>(await request('/assistant','raguser','POST',query))).cache).toBe('exact');
    expect(complete.mock.calls.length).toBe(calls);
    ragConfig.semanticCache=true;
    const reordered={...query,question:'Annual leave staff can take?'};
    expect((await jsonBody<{cache:string}>(await request('/assistant','raguser','POST',reordered))).cache).toBe('semantic');
    expect((await jsonBody<{cache:string}>(await request('/assistant','raguser','POST',{...query,question:'Can staff not take annual leave?'}))).cache).toBe('miss');
    ragConfig.semanticCache=false;
    await request(`/documents/${publicId}/archive`,'admin','POST',{});
    const removed=await jsonBody<{sources:{documentId:string}[]}>(await request('/assistant','raguser','POST',query));
    expect(removed.sources.some(p=>p.documentId===publicId)).toBe(false);
    const metrics=await jsonBody<{summary:{runs:number;cacheHits:number}}>(await request('/rag/metrics','admin'));
    expect(metrics.summary.runs).toBeGreaterThan(0);expect(metrics.summary.cacheHits).toBeGreaterThanOrEqual(2);
    expect((await request('/rag/metrics','raguser')).status).toBe(403);
    const rows=await pool.query('SELECT count(*)::integer AS n FROM people_cms.document_passages WHERE embedding IS NOT NULL');
    expect(rows.rows[0]?.n).toBe(2);
  });
  it('enforces employee PDF ownership in listing, vector candidates and source reload, including accountant leave denial',async()=>{
    const owner=people.raguser!;
    const otherResponse=await request('/employees','admin','POST',{email:'pdfother@example.test',displayName:'Other PDF Employee',role:'user',password:pass});
    people.pdfother=await jsonBody<Person>(otherResponse);await login('pdfother');
    async function upload(kind:string,employeeId:string,audience='admin'){
      const form=new FormData();form.append('file',new Blob(['%PDF-personal-'+kind],{type:'application/pdf'}),'personal-'+kind+'.pdf');
      form.append('audience',audience);form.append('recordKind',kind);form.append('employeeId',employeeId);
      return fetch(`${base}/documents/pdf`,{method:'POST',headers:{origin:'http://127.0.0.1:3000',cookie:cookies.admin!},body:form});
    }
    expect((await upload('salary',owner.id,'all')).status).toBe(400);
    expect((await upload('salary','11111111-1111-4111-8111-111111111111')).status).toBe(400);
    const salary=await upload('salary',owner.id);expect(salary.status).toBe(201);const salaryId=(await jsonBody<{id:string}>(salary)).id;
    const leave=await upload('leave',owner.id);expect(leave.status).toBe(201);const leaveId=(await jsonBody<{id:string}>(leave)).id;
    const q=new PgPeopleStore(database).queries;
    for(const [who,expected] of [['raguser',[salaryId,leaveId]],['pdfother',[]],['hr',[salaryId,leaveId]],['accountant',[salaryId]],['admin',[salaryId,leaveId]]] as const){
      const actor=people[who]!;
      const listed=await jsonBody<{id:string}[]>(await request('/documents',who));
      const ranked=await q.semanticPassages(actor.organizationId,actor.role,'synthetic-test-vectors-not-quality-evidence',fixtureVector,actor.id);
      const reloaded=await q.sources(actor.organizationId,actor.role,[{documentId:salaryId,ordinal:1},{documentId:leaveId,ordinal:1}],actor.id);
      for(const rows of [listed.map(p=>p.id),ranked.map(p=>p.documentId),reloaded.map(p=>p.documentId)]){
        expect(rows.filter(id=>[salaryId,leaveId].includes(id)).sort()).toEqual([...expected].sort());
      }
    }
    const personalAnswer=await jsonBody<{cache:string;sources:{title:string}[]}>(await request('/assistant','raguser','POST',{topic:'policy',year:2026,month:'2026-11',question:'Synthetic annual leave policy for RAG User Fixture'}));
    expect(personalAnswer.cache).toBe('miss');
    const input=JSON.parse(String(complete.mock.calls.at(-1)?.[0].messages[1].content)) as {sources:{text:string}[]};
    expect(input.sources.some(p=>p.text.includes('Employee document: RAG User Fixture'))).toBe(true);
    // A model cannot write a salary, entitlement or leave transaction from a PDF selection.
    expect(await q.payroll(owner.organizationId,owner.id,'2026-11')).toBeNull();
  });
  it('binds OIDC identity explicitly, consumes browser state once, and never trusts token roles',async()=>{
    const admin=people.admin!;const target=people.accountant!;const store=new PgPeopleStore(database);const security=new LocalPeopleSecurity();
    let attempt=0;
    const protocol={issuer:'https://identity.example.test',begin:async()=>({url:'https://identity.example.test/authorize',state:`synthetic-state-${++attempt}`,verifier:'test-verifier',nonce:'test-nonce'}),
      finish:vi.fn(async()=>({issuer:'https://identity.example.test',subject:'fixture-accountant-sub'}))};
    const loginService=new OrganizationLogin(store,security,protocol);
    await loginService.bind(admin,target.id,{subject:'fixture-accountant-sub'});
    const started=await loginService.start();const callback=new URL('http://127.0.0.1:4000/api/v1/cms/oidc/callback');callback.searchParams.set('state',started.state);
    await expect(loginService.finish(callback,'wrong-browser-state')).rejects.toMatchObject({status:401});
    const logged=await loginService.finish(callback,started.state);
    expect(logged.person.role).toBe('accountant');expect((await service.authenticate(logged.token)).id).toBe(target.id);
    await expect(loginService.finish(callback,started.state)).rejects.toMatchObject({status:401});
    expect(protocol.finish).toHaveBeenCalledTimes(1);
    const unbound=new OrganizationLogin(store,security,{...protocol,finish:async()=>({issuer:protocol.issuer,subject:'unbound'})});
    const pending=await unbound.start();callback.searchParams.set('state',pending.state);
    await expect(unbound.finish(callback,pending.state)).rejects.toMatchObject({status:403});
  });
  it('withholds a long-running answer when its session is revoked during inference',async()=>{
    complete.mockImplementationOnce(async()=>{
      await pool.query('DELETE FROM people_cms.sessions WHERE account_id=$1',[people.hr!.id]);
      return '{"sourceIds":["S1"]}';
    });
    const response=await request('/assistant','hr','POST',{topic:'policy',year:2026,month:'2026-11',question:'Restricted orchid policy?',model:'fixture-model'});
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain('Restricted orchid policy');
  });
});
