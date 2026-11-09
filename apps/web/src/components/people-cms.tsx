'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { answer as parseAnswer, cmsRequest, CmsHttpError, document as parseDocument, leaveRequest, list, object, person, snapshot as parseSnapshot } from './people-cms-api';
import type { CmsAnswer, CmsDocument, CmsLeave, CmsPerson, CmsSnapshot } from './people-cms-api';
import { PolicyPdfUpload,PolicyRunMetrics } from './policy-pdf-upload';

const FIELD = 'field-control';
const BUTTON = 'primary-button disabled:opacity-40';
const PANEL = 'surface-card p-5 md:p-6';
type Audit = { id: string; operation: string; actorId: string; outcome: string; createdAt: string };

function values(event: FormEvent<HTMLFormElement>): FormData { event.preventDefault(); return new FormData(event.currentTarget); }
function string(data: FormData, key: string): string { return String(data.get(key) ?? ''); }

export function PeopleCms() {
  const [booting, setBooting] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [me, setMe] = useState<CmsPerson | null>(null);
  const [employees, setEmployees] = useState<CmsPerson[]>([]);
  const [selected, setSelected] = useState('');
  const [snapshot, setSnapshot] = useState<CmsSnapshot | null>(null);
  const [documents, setDocuments] = useState<CmsDocument[]>([]);
  const [queue, setQueue] = useState<CmsLeave[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [modelError, setModelError] = useState('');
  const [topic, setTopic] = useState<'leave' | 'salary' | 'policy'>('policy');
  const [showRecords,setShowRecords]=useState(false);
  const [oidcEnabled,setOidcEnabled]=useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<CmsAnswer | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [recordLoading, setRecordLoading] = useState(false);
  const workspaceRequest = useRef<AbortController | null>(null);
  const recordRequest = useRef<AbortController | null>(null);
  const admin = me?.role === 'admin';
  const hr = admin || me?.role === 'hr';
  const payrollWriter = admin || me?.role === 'accountant';

  const clearPrivateState = useCallback(() => {
    workspaceRequest.current?.abort(); recordRequest.current?.abort();
    setMe(null); setEmployees([]); setSnapshot(null); setDocuments([]); setQueue([]); setAudit([]); setAnswer(null);
    setSelected(''); setQuestion(''); setModels([]); setModel('');
  }, []);
  const report = useCallback((cause: unknown) => {
    if (cause instanceof CmsHttpError && cause.status === 401) clearPrivateState();
    setError(cause instanceof Error ? cause.message : 'The CMS request failed.');
  }, [clearPrivateState]);

  useEffect(() => {
    const controller = new AbortController();
    async function start(): Promise<void> {
      try {
        const setup = object(await cmsRequest('/setup', 'GET', undefined, controller.signal));
        if (typeof setup.setupRequired !== 'boolean') throw new Error('Invalid setup response.');
        setSetupRequired(setup.setupRequired);
        const identity=object(await cmsRequest('/oidc/configuration','GET',undefined,controller.signal));
        setOidcEnabled(identity.enabled===true);
        if(new URLSearchParams(window.location.search).get('login')==='failed')setError('Organization sign-in failed or this identity is not linked to an active account.');
        if (!setup.setupRequired) {
          try { setMe(person(object(await cmsRequest('/session', 'GET', undefined, controller.signal)).person)); }
          catch (cause) { if (!(cause instanceof CmsHttpError && cause.status === 401)) throw cause; }
        }
      } catch (cause) { if (!controller.signal.aborted) report(cause); }
      finally { if (!controller.signal.aborted) setBooting(false); }
    }
    void start();
    return () => { controller.abort(); workspaceRequest.current?.abort(); recordRequest.current?.abort(); };
  }, [report]);

  const loadWorkspace = useCallback(async () => {
    if (!me) return;
    workspaceRequest.current?.abort();
    const controller = new AbortController(); workspaceRequest.current = controller;
    try {
      const people = list(await cmsRequest('/employees', 'GET', undefined, controller.signal), person);
      if (controller.signal.aborted) return;
      setEmployees(people); setSelected((current) => people.some((p) => p.id === current) ? current : me.id);
      setDocuments(list(await cmsRequest('/documents', 'GET', undefined, controller.signal), parseDocument));
      if (me.role === 'admin' || me.role === 'hr') setQueue(list(await cmsRequest(`/leave?year=${year}`, 'GET', undefined, controller.signal), leaveRequest));
      if (me.role === 'admin') {
        setAudit(list(await cmsRequest('/audit', 'GET', undefined, controller.signal), (value): Audit => {
          const entry = object(value);
          if (![entry.id, entry.operation, entry.actorId, entry.outcome, entry.createdAt].every((v) => typeof v === 'string')) throw new Error('Invalid audit event.');
          return { id: entry.id as string, operation: entry.operation as string, actorId: entry.actorId as string, outcome: entry.outcome as string, createdAt: entry.createdAt as string };
        }));
      }
    } catch (cause) { if (!controller.signal.aborted) report(cause); }
  }, [me, year, report]);
  const loadRecords = useCallback(async () => {
    if (!showRecords || !me || !selected || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    recordRequest.current?.abort();
    const controller = new AbortController(); recordRequest.current = controller;
    setRecordLoading(true); setSnapshot(null); setAnswer(null);
    try {
      const result = parseSnapshot(await cmsRequest(`/employees/${selected}/records?year=${year}&month=${month}`, 'GET', undefined, controller.signal));
      if (!controller.signal.aborted) setSnapshot(result);
    } catch (cause) { if (!controller.signal.aborted) report(cause); }
    finally { if (!controller.signal.aborted) setRecordLoading(false); }
  }, [me, selected, year, month, report,showRecords]);
  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);
  useEffect(() => { void loadRecords(); }, [loadRecords]);
  useEffect(() => {
    if (!me) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = object(await cmsRequest('/models', 'GET', undefined, controller.signal));
        if (!Array.isArray(response.models) || !response.models.every((v) => typeof v === 'string')) throw new Error('Invalid model list.');
        setModels(response.models); setModel(''); setModelError('');
      } catch (cause) { if (!controller.signal.aborted) setModelError(cause instanceof Error ? cause.message : 'Local model unavailable.'); }
    })();
    return () => controller.abort();
  }, [me]);

  async function action(work: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (cause) { report(cause); }
    finally { setBusy(false); }
  }
  async function authenticate(event: FormEvent<HTMLFormElement>): Promise<void> {
    const data = values(event); const form = event.currentTarget;
    await action(async () => {
      if (setupRequired) {
        await cmsRequest('/setup', 'POST', { organizationName: string(data, 'organizationName'), displayName: string(data, 'displayName'), email: string(data, 'email'), password: string(data, 'password') });
        setSetupRequired(false);
      }
      const result = object(await cmsRequest('/login', 'POST', { email: string(data, 'email'), password: string(data, 'password') }));
      form.reset(); setMe(person(result.person));
    });
  }
  async function mutate(path: string, method: string, body: unknown, message: string): Promise<void> {
    await cmsRequest(path, method, body); setNotice(message); setAnswer(null); await loadWorkspace(); await loadRecords();
  }
  async function ask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await action(async () => {
      setAnswer(null);
      const result = await cmsRequest('/assistant', 'POST', { topic, employeeId: selected, year, month, question, ...(topic === 'policy' && model ? { model } : {}) });
      setAnswer(parseAnswer(result));
    });
  }

  return <main className="mx-auto max-w-7xl px-5 py-6 md:px-10">
    <header className="cms-header flex flex-wrap items-center justify-between gap-4 border-b pb-5">
      <div className="flex items-center gap-3"><span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-[#fff0f2] text-xl font-bold text-[var(--accent)]">✦</span><div><p className="text-sm font-semibold tracking-tight">People</p><h1 className="text-xl font-medium text-[var(--muted)]">Employee workspace</h1></div></div>
      <nav className="flex items-center gap-5 text-sm">{me && <button className="subtle-button" disabled={busy} onClick={() => void action(async () => { await cmsRequest('/logout', 'POST', {}); clearPrivateState(); setNotice('Signed out.'); })}>Sign out</button>}</nav>
    </header>
    <p className="mt-4 text-sm text-[var(--muted)]">Local pilot · One organization · Use synthetic records</p>
    {error && <p role="alert" className="mt-4 rounded-lg border border-amber-200/30 p-3 text-sm text-amber-100">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded-xl border border-emerald-200/20 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {booting ? <p role="status" className="py-16">Checking CMS session…</p> : !me ? <section className={`${PANEL} mx-auto mt-10 max-w-md`}>
      <h2 className="text-xl font-semibold">{setupRequired ? 'Set up your local organization' : 'Sign in'}</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">{setupRequired ? 'Create the first admin. There are no default credentials. Complete setup on a trusted local machine.' : 'Use an account created by your administrator.'}</p>
      <form onSubmit={(event) => void authenticate(event)} className="mt-5 space-y-4">
        {setupRequired && <><label className="block text-sm">Organization name<input name="organizationName" required maxLength={120} className={FIELD} /></label><label className="block text-sm">Your name<input name="displayName" required maxLength={100} autoComplete="name" className={FIELD} /></label></>}
        <label className="block text-sm">Email<input name="email" type="email" required autoComplete="username" className={FIELD} /></label>
        <label className="block text-sm">Password<input name="password" type="password" required minLength={setupRequired ? 12 : 1} maxLength={128} autoComplete={setupRequired ? 'new-password' : 'current-password'} className={FIELD} /></label>
        {setupRequired && <p className="text-xs text-[var(--muted)]">Use a unique password of at least 12 characters.</p>}
        <button disabled={busy} className={BUTTON}>{busy ? 'Please wait…' : setupRequired ? 'Create organization and sign in' : 'Sign in'}</button>
        {!setupRequired&&oidcEnabled&&<button type="button" disabled={busy} className="block text-sm text-emerald-200" onClick={()=>void action(async()=>{const result=object(await cmsRequest('/oidc/start','POST',{}));if(typeof result.authorizationUrl!=='string'||new URL(result.authorizationUrl).protocol!=='https:')throw new Error('Invalid organization login destination.');window.location.assign(result.authorizationUrl);})}>Continue with Google Workspace</button>}
      </form>
    </section> : <>
      <div className="my-6 flex flex-wrap items-center justify-between gap-4"><p className="flex items-center gap-3"><strong className="text-lg">{me.displayName}</strong><span className="role-pill text-xs capitalize">{me.role}</span></p><p className="text-sm text-[var(--muted)]">{me.role === 'user' ? 'Your records' : me.role === 'accountant' ? 'Payroll · your leave' : me.role === 'hr' ? 'Team records' : 'Admin access'}</p></div>
      {admin&&<PolicyPdfUpload employees={employees} onComplete={loadWorkspace} onError={report}/>}
      <button type="button" onClick={()=>setShowRecords((current)=>!current)} className="subtle-button mb-4 text-sm">{showRecords?'Hide records and workflows':'Show records and workflows'}</button>
      {showRecords&&<section className={PANEL} aria-label="Employee records">
        <div className="flex flex-wrap items-end gap-4">
          <label htmlFor="cms-employee" className="min-w-52 flex-1 text-sm">Employee<select id="cms-employee" value={selected} onChange={(event) => setSelected(event.target.value)} disabled={busy} className={FIELD}>{employees.map((p) => <option value={p.id} key={p.id}>{p.displayName}{p.id === me.id ? ' (you)' : ''}{p.active ? '' : ' · inactive'}</option>)}</select></label>
          <label className="text-sm">Leave year<select value={year} onChange={(event) => setYear(Number(event.target.value))} disabled={busy} className={FIELD}>{Array.from({ length: 5 }, (_, index) => new Date().getUTCFullYear() - 1 + index).map((y) => <option key={y}>{y}</option>)}</select></label>
          <label className="text-sm">Salary month<input type="month" value={month} min="2000-01" max="2200-12" onChange={(event) => setMonth(event.target.value)} disabled={busy} className={FIELD} /></label>
          <button type="button" disabled={busy} onClick={() => void loadRecords()} className="px-3 py-2 text-sm text-emerald-200">Refresh records</button>
        </div>
        {recordLoading && <p role="status" className="mt-5 text-sm">Loading authorized records…</p>}
        {snapshot && <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] p-4"><h2 className="font-medium">Leave · {snapshot.employee.displayName}</h2>{!snapshot.leaveAllowed ? <p className="mt-3 text-sm text-[var(--muted)]">Your role cannot view this employee’s leave.</p> : !snapshot.leave?.configured ? <p className="mt-3 text-sm text-[var(--muted)]">Entitlement not configured for {year}.</p> : <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><dt>Entitlement</dt><dd>{snapshot.leave.entitlementDays} calendar days</dd><dt>Approved</dt><dd>{snapshot.leave.approvedDays}</dd><dt>Pending / reserved</dt><dd>{snapshot.leave.pendingDays}</dd><dt>Available to apply</dt><dd className="font-semibold text-emerald-200">{snapshot.leave.availableDays}</dd></dl>}</div>
          <div className="rounded-xl border border-[var(--border)] p-4"><h2 className="font-medium">Recorded salary · {month}</h2><p className="mt-3 text-lg">{snapshot.payroll ? new Intl.NumberFormat('en', { style: 'currency', currency: snapshot.payroll.currency }).format(snapshot.payroll.amountMinor / 100) : 'Not recorded'}</p><p className="mt-2 text-xs text-[var(--muted)]">Recorded amount for the selected period; not a payslip, tax calculation, or payment confirmation.</p></div>
        </div>}
      </section>}

      <section className={`${PANEL} mt-5`} aria-label="Employee assistant">
        <h2 className="text-lg font-semibold">Ask People Assistant</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Answers use only records your role can access. PDF records are snapshots.</p>
        <form onSubmit={(event) => void ask(event)} className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-4"><label className="text-sm">Ask about<select value={topic} onChange={(event) => { setTopic(event.target.value as typeof topic); if(event.target.value!=='policy')setShowRecords(true); setAnswer(null); }} disabled={busy} className={FIELD}><option value="leave">Leave balance</option><option value="salary">Salary record</option><option value="policy">Uploaded PDFs · policies and personal records</option></select></label>{topic === 'policy' && <label className="min-w-56 flex-1 text-sm">Local model<select value={model} onChange={(event) => { setModel(event.target.value); setAnswer(null); }} disabled={busy} className={FIELD}><option value="">{models.length?'Auto · server routing':'No model available'}</option>{models.map((m) => <option key={m}>{m}</option>)}</select></label>}</div>
          <label className="block text-sm">Your question<textarea value={question} onChange={(event) => { setQuestion(event.target.value); setAnswer(null); }} required maxLength={1000} rows={2} className={FIELD} placeholder="How many leave days are available?" /></label>
          <button className={BUTTON} disabled={busy || !selected || !question.trim() || (topic === 'policy' && models.length===0)}>{busy ? 'Working…' : 'Ask assistant'}</button>
        </form>
        {modelError && <p className="mt-3 text-xs text-amber-100">Policy inference unavailable: {modelError} Salary and leave records still work.</p>}
        {answer && <div aria-live="polite" className="mt-5 border-t border-[var(--border)] pt-4"><p className="whitespace-pre-wrap text-sm leading-7">{answer.content}</p>{answer.sources.map((s, i) => <article key={`${s.documentId}-${s.lineStart}-${i}`} className="mt-4 rounded-lg border border-[var(--border)] p-4"><h3 className="text-sm font-medium text-emerald-200">{s.title}{s.pageNumber!==null?` · page ${s.pageNumber}`:''} · extracted lines {s.lineStart}–{s.lineEnd}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{s.content}</p></article>)}</div>}
      </section>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        {showRecords&&<section className={PANEL}><h2 className="text-lg font-semibold">Request leave</h2><p className="mt-1 text-sm text-[var(--muted)]">Requests are submitted for your account. Pending days are reserved.</p>
          <form className="mt-4 space-y-3" onSubmit={(event) => { const data = values(event); const form = event.currentTarget; void action(async () => { await mutate('/leave', 'POST', { startDate: string(data, 'start'), endDate: string(data, 'end'), reason: string(data, 'reason') }, 'Leave request submitted.'); form.reset(); }); }}>
            <div className="grid grid-cols-2 gap-3"><label className="text-sm">Start date<input name="start" type="date" required className={FIELD} /></label><label className="text-sm">End date<input name="end" type="date" required className={FIELD} /></label></div>
            <label className="block text-sm">Reason<textarea name="reason" required maxLength={500} rows={2} className={FIELD} /></label><button disabled={busy} className={BUTTON}>Submit request</button>
          </form>
          {snapshot?.leaveAllowed && <div className="mt-5 space-y-2"><h3 className="text-sm font-medium">Selected employee’s requests</h3>{!snapshot.requests.length && <p className="text-xs text-[var(--muted)]">No requests recorded for {year}.</p>}{snapshot.requests.map((r) => <p className="border-t border-[var(--border)] pt-2 text-xs" key={r.id}>{r.startDate} → {r.endDate} · {r.days} days · {r.status}</p>)}</div>}
        </section>}
        <section className={PANEL}><h2 className="text-lg font-semibold">Documents</h2><div className="mt-4 space-y-3">{!documents.length && <p className="text-sm text-[var(--muted)]">No documents yet.</p>}{documents.map((d) => <div key={d.id} className="flex items-start justify-between gap-3 border-t border-[var(--border)] pt-3"><div><p className="text-sm font-medium">{d.title}</p><p className="mt-1 text-xs text-[var(--muted)]">{d.filename} · {d.audience === 'all' ? 'All employees' : d.audience}</p></div>{admin && <button disabled={busy} className="text-xs text-amber-700" onClick={() => void action(() => mutate(`/documents/${d.id}/archive`, 'POST', {}, 'Document archived from future searches.'))}>Archive</button>}</div>)}</div></section>
      </div>

      {showRecords&&hr && <section className={`${PANEL} mt-5`}><h2 className="text-lg font-semibold">HR leave requests · {year}</h2><p className="mt-2 text-xs text-[var(--muted)]">You cannot approve or reject your own request.</p><div className="mt-4 space-y-3">{!queue.length && <p className="text-sm text-[var(--muted)]">No requests for this year.</p>}{queue.map((r) => <article key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3"><div><p className="text-sm font-medium">{r.employeeName} · {r.days} days · {r.status}</p><p className="mt-1 text-xs text-[var(--muted)]">{r.startDate} → {r.endDate} · {r.reason}</p></div>{r.status === 'pending' && r.employeeId !== me.id && <div className="flex gap-3">{(['approved', 'rejected'] as const).map((status) => <button key={status} disabled={busy} className="text-sm text-emerald-200" onClick={() => void action(() => mutate(`/leave/${r.id}`, 'PUT', { status }, `Leave ${status}.`))}>{status === 'approved' ? 'Approve' : 'Reject'}</button>)}</div>}</article>)}</div></section>}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {showRecords&&hr && <section className={PANEL}><h2 className="text-lg font-semibold">Set leave entitlement</h2><p className="mt-2 text-xs text-[var(--muted)]">For the selected employee and {year}. Cannot reduce below approved and pending days.</p><form className="mt-4 flex items-end gap-3" onSubmit={(event) => { const data = values(event); void action(() => mutate(`/employees/${selected}/entitlement`, 'PUT', { year, days: Number(string(data, 'days')) }, 'Leave entitlement saved.')); }}><label className="flex-1 text-sm">Calendar days<input name="days" type="number" min={0} max={366} required className={FIELD} /></label><button disabled={busy || !selected} className={BUTTON}>Save</button></form></section>}
        {showRecords&&payrollWriter && <section className={PANEL}><h2 className="text-lg font-semibold">Record salary</h2><p className="mt-2 text-xs text-[var(--muted)]">For the selected employee and {month}. This records a value; it does not send payment.</p><form className="mt-4 space-y-3" onSubmit={(event) => { const data = values(event); const amount = Math.round(Number(string(data, 'amount')) * 100); void action(() => mutate(`/employees/${selected}/payroll`, 'PUT', { month, amountMinor: amount, currency: string(data, 'currency') }, 'Salary record saved.')); }}><div className="grid grid-cols-2 gap-3"><label className="text-sm">Amount<input name="amount" type="number" min={0} max={1e10} step="0.01" required className={FIELD} /></label><label className="text-sm">Currency<select name="currency" className={FIELD}>{['NPR', 'USD', 'INR', 'EUR'].map((c) => <option key={c}>{c}</option>)}</select></label></div><button disabled={busy || !selected || !month} className={BUTTON}>Save recorded amount</button></form></section>}
      </div>

      {admin && <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <section className={PANEL}><h2 className="text-lg font-semibold">Create an employee account</h2><form className="mt-4 space-y-3" onSubmit={(event) => { const data = values(event); const form = event.currentTarget; void action(async () => { await mutate('/employees', 'POST', { displayName: string(data, 'name'), email: string(data, 'email'), role: string(data, 'role'), password: string(data, 'password') }, 'Account created. Share the initial password privately; employees can change it after sign-in.'); form.reset(); }); }}><label className="block text-sm">Name<input name="name" required maxLength={100} className={FIELD} /></label><label className="block text-sm">Email<input name="email" type="email" required className={FIELD} /></label><label className="block text-sm">Role<select name="role" className={FIELD}>{['user', 'hr', 'accountant', 'admin'].map((r) => <option key={r}>{r}</option>)}</select></label><label className="block text-sm">Initial password<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" className={FIELD} /></label><button disabled={busy} className={BUTTON}>Create account</button></form>
          <details className="mt-5"><summary className="cursor-pointer text-sm">Manage account roles and access</summary><p className="mt-2 text-xs text-[var(--muted)]">Changes revoke all sessions for that account. You cannot change your own role/status.</p>{employees.filter((p) => p.id !== me.id).map((p) => <form key={`${p.id}-${p.role}-${p.active}`} className="mt-3 border-t border-[var(--border)] pt-3" onSubmit={(event) => { const data = values(event); void action(() => mutate(`/employees/${p.id}`, 'PUT', { role: string(data, 'role'), active: data.get('active') === 'on' }, 'Account updated and sessions revoked.')); }}><p className="text-sm">{p.displayName} · {p.email}</p><div className="mt-2 flex flex-wrap items-center gap-3"><select aria-label={`Role for ${p.displayName}`} name="role" defaultValue={p.role} className="rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">{['user', 'hr', 'accountant', 'admin'].map((r) => <option key={r}>{r}</option>)}</select><label className="text-xs"><input type="checkbox" name="active" defaultChecked={p.active} /> Active</label><button disabled={busy} className="text-xs text-emerald-200">Apply role/status</button></div></form>)}</details>
        </section>
        {oidcEnabled&&<section className={PANEL}><h2 className="text-lg font-semibold">Link an organization identity</h2><p className="mt-2 text-xs text-[var(--muted)]">For the selected employee, use the exact subject from the configured identity provider. This revokes their sessions. Email and token roles do not grant access.</p><form className="mt-4 space-y-3" onSubmit={(event)=>{const data=values(event);void action(()=>mutate(`/oidc/employees/${selected}`,'POST',{subject:string(data,'subject')},'Organization identity linked; employee sessions revoked.'));}}><label className="block text-sm">Identity provider subject<input name="subject" required maxLength={255} className={FIELD}/></label><button disabled={busy||!selected} className={BUTTON}>Link selected employee identity</button></form></section>}
      </div>}

      {admin&&<PolicyRunMetrics/>}
      {admin && <section className={`${PANEL} mt-5`}><h2 className="text-lg font-semibold">Recent audit decisions</h2><p className="mt-2 text-xs text-[var(--muted)]">Latest 100 events. No salary values, passwords, document bodies, or questions are stored in these events.</p><div className="mt-4 max-h-64 overflow-auto space-y-2">{audit.map((event) => <p className="border-t border-[var(--border)] pt-2 text-xs" key={event.id}>{event.createdAt} · {event.operation} · {event.outcome} · actor {event.actorId}</p>)}</div></section>}

      <details className={`${PANEL} mt-5`}><summary className="cursor-pointer text-sm font-medium">Change your password</summary><p className="mt-2 text-xs text-[var(--muted)]">Changing it signs out every session for your account.</p><form className="mt-4 max-w-md space-y-3" onSubmit={(event) => { const data = values(event); const form = event.currentTarget; void action(async () => { await cmsRequest('/password', 'POST', { currentPassword: string(data, 'current'), newPassword: string(data, 'next') }); form.reset(); clearPrivateState(); setNotice('Password changed. Sign in again.'); }); }}><label className="block text-sm">Current password<input name="current" type="password" required autoComplete="current-password" className={FIELD} /></label><label className="block text-sm">New password<input name="next" type="password" required minLength={12} maxLength={128} autoComplete="new-password" className={FIELD} /></label><button disabled={busy} className={BUTTON}>Change password and sign out</button></form></details>
    </>}
  </main>;
}
