import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { Person } from './people.contracts';
import type { PolicyCompute } from './policy-rag.contracts';
import { PeopleError } from './people.policy';

const vectorSchema = z.array(z.number().finite().min(-1).max(1)).length(384)
  .refine((values) => Math.abs(Math.sqrt(values.reduce((sum,v) => sum+v*v,0))-1) < 0.02);
const profileSchema = z.string().min(1).max(200);
const pdfSchema = z.object({ profile: profileSchema, pageCount: z.number().int().min(1).max(100), passages: z.array(z.object({
  ordinal: z.number().int().min(1).max(200), pageNumber: z.number().int().min(1).max(100), lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(), text: z.string().min(1).max(1200), embedding: vectorSchema,
}).strict()).min(1).max(200) }).strict().refine((result) => result.passages.every((p,i) => p.ordinal === i+1 && p.pageNumber<=result.pageCount && p.lineEnd>=p.lineStart));

export class PolicyComputeClient implements PolicyCompute {
  constructor(private readonly baseUrl: string, private readonly secret: string, private readonly timeoutMs: number) {}
  async indexPdf(bytes: Uint8Array, actor: Person, requestId: string) {
    const result = pdfSchema.safeParse(await this.call('pdf_index', { pdfBase64: Buffer.from(bytes).toString('base64') }, actor, requestId));
    if (!result.success) throw new PeopleError(502, 'The context engine returned invalid PDF evidence. Nothing was indexed.');
    return result.data;
  }
  async embed(question: string, actor: Person, requestId: string) {
    const result = z.object({ profile: profileSchema, vector: vectorSchema }).strict().safeParse(await this.call('embed_query', { question }, actor, requestId));
    if (!result.success) throw new PeopleError(502, 'The local embedding provider returned an invalid vector.');
    return result.data;
  }
  private async call(operation: string, data: Record<string, unknown>, actor: Person, requestId: string): Promise<unknown> {
    const body = JSON.stringify({ ...data, scope: { organizationId: actor.organizationId, userId: actor.id, operation, issuedAt: Math.floor(Date.now()/1000) } });
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/,'')}/internal/policy/compute`, { method: 'POST', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(this.timeoutMs), body, headers: { 'content-type': 'application/json', authorization: `Bearer ${this.secret}`,
          'x-request-id': requestId, 'x-policy-signature': createHmac('sha256',this.secret).update(body).digest('hex') } });
    } catch { throw new PeopleError(503, 'Local PDF/embedding computation is unavailable or timed out. No cloud fallback was used.'); }
    if (!response.ok) {
      if (response.status === 422) throw new PeopleError(422, 'PDF extraction was rejected: check for scanned/encrypted files, credentials, active content, or resource limits. A text PDF up to 100 pages is required.');
      if (response.status === 429) throw new PeopleError(429, 'Local PDF/embedding computation is busy. Retry shortly.');
      throw new PeopleError(503, 'Local PDF/embedding computation is unavailable. Prepare the local embedding model and start the context engine.');
    }
    const reader = response.body?.getReader(); if (!reader) throw new PeopleError(502, 'Missing context-engine response.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 3 * 1024 * 1024) { await reader.cancel(); throw new PeopleError(502, 'Context-engine response exceeded the resource limit.'); }
      chunks.push(next.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
    catch { throw new PeopleError(502, 'Malformed context-engine response.'); }
  }
}
