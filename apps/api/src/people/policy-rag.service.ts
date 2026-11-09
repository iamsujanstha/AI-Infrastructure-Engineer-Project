import { z } from 'zod';
import type { PeopleSecurity, PeopleStore, Person, PolicyAnswerPort } from './people.contracts';
import type { CacheScope, PolicyCompute, PolicyRagConfig, PolicyRun, RagPassage } from './policy-rag.contracts';
import { PeopleError, requireRole } from './people.policy';

const selectionText = (p: RagPassage): string => p.recordKind && p.recordKind!=='policy' ? `[Employee document: ${p.title}]\n${p.content}` : p.content;
const key = (p: { documentId: string; ordinal: number }): string => `${p.documentId}:${p.ordinal}`;
export function hybridRank(channels: readonly RagPassage[][]): RagPassage[] {
  const ranked = new Map<string, { passage: RagPassage; score: number }>();
  for (const channel of channels) channel.forEach((p, i) => {
    const id = key(p); const previous = ranked.get(id);
    ranked.set(id, { passage: p, score: (previous?.score ?? 0) + 1 / (60 + i + 1) });
  });
  return [...ranked.values()].sort((a, b) => b.score - a.score || key(a.passage).localeCompare(key(b.passage))).map((r) => r.passage);
}
export function routePolicyModel(question: string, available: readonly string[], config: PolicyRagConfig, requested?: string): { model: string; reason: string } {
  if (!available.length) throw new PeopleError(503, 'No local inference models are available.');
  if (requested) {
    if (!available.includes(requested)) throw new PeopleError(400, 'The selected model is not available.');
    return { model: requested, reason: 'explicit_available_model' };
  }
  const complex = question.split(/\s+/).length > 18 || /\b(compare|conflict|exception|difference|explain)\b/i.test(question);
  if (!complex && config.smallModel && available.includes(config.smallModel)) return { model: config.smallModel, reason: 'configured_short_question_route' };
  if (config.largeModel && available.includes(config.largeModel)) return { model: config.largeModel, reason: complex ? 'configured_complex_question_route' : 'configured_default_route' };
  return { model: available[0]!, reason: 'provider_available_default' };
}

export class PolicyRagService {
  constructor(private readonly store: PeopleStore, private readonly security: PeopleSecurity,
    private readonly references: PolicyAnswerPort, private readonly compute: PolicyCompute, private readonly config: PolicyRagConfig) {}

  async uploadPdf(actor: Person, input: unknown, bytes: Uint8Array, requestId: string): Promise<{ id: string; pageCount: number; passageCount: number; embeddingProfile: string }> {
    requireRole(actor, ['admin']);
    const parsed = z.object({ filename: z.string().regex(/^[A-Za-z0-9_. -]+\.pdf$/i).max(160), audience: z.enum(['all','hr','accountant','admin']), recordKind:z.enum(['policy','salary','leave']).default('policy'),employeeId:z.string().uuid().nullable().default(null) }).strict().safeParse(input);
    if (!parsed.success || bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024) throw new PeopleError(400, 'Upload one PDF up to 5 MiB and choose its audience.');
    if(parsed.data.recordKind==='policy' ? parsed.data.employeeId!==null : !parsed.data.employeeId || parsed.data.audience!=='admin')throw new PeopleError(400,'Personal PDFs require one employee owner, salary/leave category, and private audience.');
    if(parsed.data.employeeId && !await this.store.queries.person(actor.organizationId,parsed.data.employeeId))throw new PeopleError(400,'Choose an employee in this organization.');
    const started = performance.now();
    try {
      const computed = await this.compute.indexPdf(bytes, actor, requestId);
      return await this.store.transaction(async (q) => {
        await q.lockPerson(actor.organizationId, actor.id);
        const current=await q.person(actor.organizationId,actor.id);
        if(!current?.active||current.role!=='admin')throw new PeopleError(403,'Administrator access changed during PDF indexing.');
        const id = await q.createPdf(actor.organizationId, actor.id, { ...parsed.data, ...computed, hash: this.security.hashBytes(bytes) });
        await q.audit(actor.organizationId, actor.id, 'document.pdf_index', id);
        await q.recordRun({ requestId, organizationId: actor.organizationId, actorId: actor.id, operation: 'pdf_index', outcome: 'ok', profile: computed.profile, sourceCount: computed.passages.length, totalMs: performance.now() - started });
        return { id, pageCount: computed.pageCount, passageCount: computed.passages.length, embeddingProfile: computed.profile };
      });
    } catch (error) {
      await this.store.queries.recordRun({ requestId, organizationId: actor.organizationId, actorId: actor.id, operation: 'pdf_index', outcome: 'error', sourceCount: 0, totalMs: performance.now() - started }).catch(() => undefined);
      throw error;
    }
  }

  async ask(actor: Person, input: { question: string; model?: string }, requestId: string) {
    const started = performance.now();
    const run: PolicyRun = { requestId, organizationId: actor.organizationId, actorId: actor.id, operation: 'policy_answer', outcome: 'error', sourceCount: 0, totalMs: 0, cacheKind: 'miss' };
    try {
      if (!input.question.trim() || input.question.length > 1000) throw new PeopleError(400, 'Ask a policy question up to 1,000 characters.');
      this.references.prepare(input.question);
      await this.current(actor);
      const revision = await this.store.queries.policyRevision(actor.organizationId);
      const embedded = await this.compute.embed(input.question, actor, requestId);
      const route = routePolicyModel(input.question, (await this.references.models()).models, this.config, input.model);
      run.model = route.model; run.profile = embedded.profile;
      const normalized = input.question.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
      // Semantic reuse retains every qualifier/number/negation token; it is opt-in, not a security boundary.
      const fingerprint = (normalized.match(/[\p{L}\p{N}]+/gu) ?? []).sort().join(' ');
      const scope: CacheScope = { organizationId: actor.organizationId, actorId: actor.id, role: actor.role, revision, profile: embedded.profile, model: route.model,
        questionHash: this.security.hashText(`policy-selection-v2:${normalized}`), fingerprint: this.security.hashText(fingerprint), vector: embedded.vector };
      const cached = await this.store.queries.cached(scope, this.config.semanticCache);
      let selected: RagPassage[] | null = null;
      if (cached) {
        const currentSources = await this.store.queries.sources(actor.organizationId, actor.role, cached.sources,actor.id);
        if (currentSources.length === cached.sources.length) { selected = currentSources; run.cacheKind = cached.kind; }
      }
      if (!selected) {
        const words = [...new Set(normalized.match(/[a-z0-9]+/g) ?? [])].slice(0,24);
        const semantic = await this.store.queries.semanticPassages(actor.organizationId, actor.role, embedded.profile, embedded.vector,actor.id);
        const lexical = words.length ? await this.store.queries.lexicalPassages(actor.organizationId, actor.role, words.join(' | '),actor.id) : [];
        const candidates: RagPassage[] = []; let bytes = 0;
        for (const passage of hybridRank([semantic, lexical])) {
          const size = new TextEncoder().encode(selectionText(passage)).length;
          if (bytes + size > 3500 || candidates.length === 8) continue;
          candidates.push(passage); bytes += size;
        }
        run.retrievalMs = performance.now() - started;
        selected = [];
        if (candidates.length) {
          await this.current(actor, revision);
          const inferenceStarted = performance.now();
          const result = await this.references.select(route.model, input.question, candidates.map((p,i) => ({ id: `S${i+1}`, text: selectionText(p), lineStart: p.lineStart, lineEnd: p.lineEnd })), requestId);
          run.inferenceMs = performance.now() - inferenceStarted;
          selected = result.sources.map((source) => {
            const match = /^S([1-8])$/.exec(source.id); const p = match ? candidates[Number(match[1])-1] : undefined;
            if (!p || selectionText(p) !== source.text) throw new PeopleError(502, 'Invalid policy evidence selection; no answer was accepted.');
            return p;
          });
        }
        await this.current(actor, revision);
        if(selected.every(p=>!p.recordKind||p.recordKind==='policy'))await this.store.queries.cache(scope, selected.map((p) => ({ documentId: p.documentId, ordinal: p.ordinal })));
      }
      await this.current(actor, revision);
      run.retrievalMs ??= performance.now() - started;
      run.outcome = selected.length ? 'ok' : 'not_found'; run.sourceCount = selected.length; run.totalMs = performance.now() - started;
      await this.store.queries.audit(actor.organizationId, actor.id, 'assistant.rag_policy', null);
      await this.store.queries.recordRun(run);
      return { kind: 'policy', status: selected.length ? 'evidence_selected' : 'not_found',
        content: selected.length ? 'Selected document evidence permitted for your account. Personal PDFs are dated snapshots, not live balances; check employee identity and applicability.' : 'I could not find an answer in the policies available to your account.',
        sources: selected, requestId, retrievalMode: 'authorized_hybrid_exact_vector', cache: run.cacheKind, routing: route, embeddingProfile: embedded.profile,
        timings: { retrievalMs: run.retrievalMs, inferenceMs: run.inferenceMs ?? null, totalMs: run.totalMs } };
    } catch (error) {
      run.outcome='error';
      run.totalMs = performance.now()-started;
      await this.store.queries.recordRun(run).catch(() => undefined);
      throw error;
    }
  }
  async metrics(actor: Person): Promise<unknown> { requireRole(actor, ['admin']); return this.store.queries.statistics(actor.organizationId); }
  private async current(actor: Person, revision?: string): Promise<void> {
    const current = await this.store.queries.person(actor.organizationId, actor.id);
    if (!current?.active || current.role !== actor.role) throw new PeopleError(401, 'Your access changed. Sign in again.');
    if (revision !== undefined && revision !== await this.store.queries.policyRevision(actor.organizationId)) throw new PeopleError(409, 'Policies changed during this request. Ask again for current evidence.');
  }
}
