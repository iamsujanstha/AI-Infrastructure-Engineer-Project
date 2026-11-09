'use client';
import { useState, type FormEvent } from 'react';
import { cmsRequest, cmsUploadPdf, object, type CmsPerson } from './people-cms-api';

export function PolicyPdfUpload({ employees,onComplete, onError }: { employees: readonly CmsPerson[]; onComplete: () => Promise<void>; onError: (cause:unknown)=>void }) {
  const [kind,setKind]=useState('policy');
  const [busy,setBusy]=useState(false); const [result,setResult]=useState('');
  async function upload(event:FormEvent<HTMLFormElement>):Promise<void> {
    event.preventDefault(); if(busy)return; const form=event.currentTarget; const data=new FormData(form);
    setBusy(true);setResult('');
    try {
      const file=data.get('pdf'); if(!(file instanceof File)||!file.name.toLowerCase().endsWith('.pdf')||file.size===0||file.size>5*1024*1024)throw new Error('Choose one PDF up to 5 MiB.');
      const indexed=object(await cmsUploadPdf(file,kind==='policy'?String(data.get('audience')??'admin'):'admin',kind,kind==='policy'?undefined:String(data.get('employeeId')??'')));
      if(typeof indexed.pageCount!=='number'||typeof indexed.passageCount!=='number')throw new Error('Invalid PDF indexing result.');
      setResult(`Indexed ${indexed.pageCount} pages and ${indexed.passageCount} passages locally. The original PDF is not retained by this feature.`);
      form.reset();setKind('policy');await onComplete();
    }catch(cause){onError(cause);}finally{setBusy(false);}
  }
  return <section aria-label="PDF policy upload" className="surface-card my-5 p-5 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Add a PDF</h2><p className="mt-1 text-sm text-[var(--muted)]">Text is extracted and indexed on this device.</p></div><span className="rounded-full bg-[#fff0f2] px-3 py-1 text-xs font-medium text-[var(--accent)]">PDF · up to 5 MiB</span></div>
    <form onSubmit={(event)=>void upload(event)} className="mt-4 flex flex-wrap items-end gap-4">
      <label htmlFor="pdf-kind" className="text-sm">Type<select id="pdf-kind" value={kind} onChange={(event)=>setKind(event.target.value)} disabled={busy} className="field-control"><option value="policy">Company policy</option><option value="salary">Employee salary</option><option value="leave">Employee leave</option></select></label>
      {kind!=='policy'&&<label htmlFor="pdf-employee" className="text-sm">Employee<select id="pdf-employee" name="employeeId" required defaultValue="" disabled={busy} className="field-control"><option value="" disabled>Select employee</option>{employees.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.displayName} · {p.email}</option>)}</select></label>}
      <label htmlFor="policy-pdf" className="min-w-60 flex-1 text-sm">PDF file<input id="policy-pdf" name="pdf" type="file" accept="application/pdf,.pdf" required disabled={busy} className="field-control"/></label>
      {kind==='policy'&&<label htmlFor="policy-audience" className="text-sm">Who can view?<select id="policy-audience" name="audience" defaultValue="admin" disabled={busy} className="field-control"><option value="admin">Admins</option><option value="hr">HR and admins</option><option value="accountant">Accountants and admins</option><option value="all">Everyone</option></select></label>}
      <button disabled={busy} className="primary-button disabled:opacity-40">{busy?'Indexing…':'Upload PDF'}</button>
    </form>
    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Use one employee and one record type per personal PDF. Check its audience and owner before upload. Scanned/encrypted files and OCR are unsupported; screening is incomplete.</p>
    {busy&&<p role="status" className="mt-3 text-sm">Waiting for bounded extraction and local embeddings…</p>}
    {result&&<p role="status" className="mt-3 text-sm text-emerald-100">{result}</p>}
  </section>;
}

export function PolicyRunMetrics() {
  const [metrics,setMetrics]=useState<{runs:number;errors:number;cacheHits:number;median:number|null}|null>(null); const [error,setError]=useState('');
  async function load():Promise<void>{try{const data=object(await cmsRequest('/rag/metrics'));const summary=object(data.summary);
    if(typeof summary.runs!=='number'||typeof summary.errors!=='number'||typeof summary.cacheHits!=='number'||(summary.medianTotalMs!==null&&typeof summary.medianTotalMs!=='number'))throw new Error('Invalid policy measurements.');
    setMetrics({runs:summary.runs,errors:summary.errors,cacheHits:summary.cacheHits,median:summary.medianTotalMs as number|null});setError('');
  }catch(cause){setError(cause instanceof Error?cause.message:'Measurements unavailable.');}}
  return <section className="mt-5 rounded-2xl border border-[var(--border)] p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Policy run measurements</h2><button onClick={()=>void load()} className="text-sm text-emerald-200">Load measurements</button></div><p className="mt-2 text-xs text-[var(--muted)]">Real PDF-index and policy-answer runs in the last 24 hours. No prompt text is logged here.</p>{error&&<p role="alert" className="mt-3 text-sm text-amber-100">{error}</p>}{metrics&&<dl className="mt-4 grid grid-cols-2 gap-2 text-sm"><dt>Recorded runs</dt><dd>{metrics.runs}</dd><dt>Errors</dt><dd>{metrics.errors}</dd><dt>Cache hits</dt><dd>{metrics.cacheHits}</dd><dt>Median total time</dt><dd>{metrics.median===null?'UNKNOWN — no runs':`${Math.round(metrics.median)} ms`}</dd></dl>}</section>;
}
