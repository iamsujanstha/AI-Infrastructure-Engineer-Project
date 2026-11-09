export type CmsRole = 'admin' | 'hr' | 'accountant' | 'user';
export interface CmsPerson { id: string; organizationId: string; email: string; displayName: string; role: CmsRole; active: boolean }
export interface CmsLeave { id: string; employeeId: string; employeeName: string; startDate: string; endDate: string; days: number; reason: string; status: string }
export interface CmsDocument { id: string; title: string; filename: string; audience: string }
export interface CmsSnapshot {
  employee: CmsPerson; leaveAllowed: boolean; salaryAllowed: boolean;
  leave: null | { configured: boolean; entitlementDays: number | null; approvedDays: number; pendingDays: number; availableDays: number | null };
  payroll: null | { month: string; amountMinor: number; currency: string };
  requests: CmsLeave[];
}
export interface CmsAnswer { content: string; requestId?: string; cache?: string; sources: { documentId: string; title: string; pageNumber: number | null; lineStart: number; lineEnd: number; content: string }[] }
export class CmsHttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('The CMS returned an invalid response.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('Invalid CMS text field.'); return value; }
function num(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid CMS numeric field.'); return value; }
function nullableNumber(value: unknown): number | null { return value === null ? null : num(value); }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('Invalid CMS flag.'); return value; }
export function list<T>(value: unknown, parser: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('The CMS returned an invalid list.');
  return value.map(parser);
}
export function person(value: unknown): CmsPerson {
  const p = object(value); const role = text(p.role);
  if (!['admin', 'hr', 'accountant', 'user'].includes(role)) throw new Error('Invalid CMS role.');
  return { id: text(p.id), organizationId: text(p.organizationId), email: text(p.email), displayName: text(p.displayName), role: role as CmsRole, active: bool(p.active) };
}
export function leaveRequest(value: unknown): CmsLeave {
  const p = object(value);
  if (!['pending', 'approved', 'rejected'].includes(text(p.status))) throw new Error('Invalid leave status.');
  return { id: text(p.id), employeeId: text(p.employeeId), employeeName: text(p.employeeName), startDate: text(p.startDate), endDate: text(p.endDate), days: num(p.days), reason: text(p.reason), status: text(p.status) };
}
export function document(value: unknown): CmsDocument {
  const p = object(value); return { id: text(p.id), title: text(p.title), filename: text(p.filename), audience: text(p.audience) };
}
export function snapshot(value: unknown): CmsSnapshot {
  const p = object(value); const b = p.leave === null ? null : object(p.leave); const pay = p.payroll === null ? null : object(p.payroll);
  return { employee: person(p.employee), leaveAllowed: bool(p.leaveAllowed), salaryAllowed: bool(p.salaryAllowed),
    leave: b ? { configured: bool(b.configured), entitlementDays: nullableNumber(b.entitlementDays), approvedDays: num(b.approvedDays), pendingDays: num(b.pendingDays), availableDays: nullableNumber(b.availableDays) } : null,
    payroll: pay ? { month: text(pay.month), amountMinor: num(pay.amountMinor), currency: text(pay.currency) } : null,
    requests: list(p.requests, leaveRequest),
  };
}
export function answer(value: unknown): CmsAnswer {
  const p = object(value);
  return { content: text(p.content), requestId:typeof p.requestId==='string'?p.requestId:undefined, cache:typeof p.cache==='string'?p.cache:undefined, sources: p.sources === undefined ? [] : list(p.sources, (item) => {
    const s = object(item);
    return { documentId: text(s.documentId), title: text(s.title), pageNumber:s.pageNumber===undefined||s.pageNumber===null?null:num(s.pageNumber), lineStart: num(s.lineStart), lineEnd: num(s.lineEnd), content: text(s.content) };
  }) };
}
export async function cmsUploadPdf(file: File, audience: string, recordKind='policy',employeeId?:string): Promise<unknown> {
  const body=new FormData(); body.append('file',file); body.append('audience',audience);body.append('recordKind',recordKind);if(employeeId)body.append('employeeId',employeeId);
  const response=await fetch(`${BASE}/api/v1/cms/documents/pdf`,{method:'POST',body,credentials:'include',cache:'no-store'});
  const result:unknown=await response.json().catch(()=>null);
  if(!response.ok) throw new CmsHttpError(response.status,typeof result==='object'&&result!==null&&'message'in result&&typeof result.message==='string'?result.message:'PDF indexing failed.');
  return result;
}
export async function cmsRequest(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${BASE}/api/v1/cms${path}`, { method, credentials: 'include', cache: 'no-store', signal,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result === 'object' && result !== null && 'message' in result && typeof result.message === 'string'
      ? result.message : 'The CMS request failed.';
    throw new CmsHttpError(response.status, message);
  }
  return result;
}
