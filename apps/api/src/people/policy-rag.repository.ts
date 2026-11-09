import { documentPermission, documentTitle } from './document-permission';
import type { QueryResult, QueryResultRow } from 'pg';
import type { PeopleRole } from './people.contracts';
import type { CacheScope, PdfPassage, PolicyRun, RagPassage, RagQueries, SourceKey } from './policy-rag.contracts';

export interface PolicySql { query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>> }
const FIELDS = `p.document_id AS "documentId",${documentTitle('d')} AS title,d.record_kind AS "recordKind",d.employee_id AS "employeeId",p.ordinal,p.page_number AS "pageNumber",p.line_start AS "lineStart",p.line_end AS "lineEnd",p.content`;
const JOIN = 'FROM people_cms.document_passages p JOIN people_cms.documents d ON d.organization_id=p.organization_id AND d.id=p.document_id';
const permit = (actor: string): string => `p.organization_id=$1 AND d.active AND ${documentPermission('d','$2',actor)}`;

export class PgRagQueries implements RagQueries {
  constructor(protected readonly sql: PolicySql) {}
  async policyRevision(org: string): Promise<string> {
    return (await this.sql.query<{ revision: string }>('SELECT policy_revision::text AS revision FROM people_cms.organizations WHERE id=$1', [org])).rows[0]!.revision;
  }
  async createPdf(org: string, actor: string, input: { filename: string; audience: string; hash: string; profile: string; pageCount: number; passages: PdfPassage[]; recordKind: 'policy'|'salary'|'leave'; employeeId: string|null }): Promise<string> {
    await this.sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${org}:${input.hash}:${input.audience}:${input.profile}:${input.recordKind}:${input.employeeId}`]);
    const previous=(await this.sql.query<{id:string}>(`SELECT id FROM people_cms.documents WHERE organization_id=$1 AND content_hash=$2 AND audience=$3
      AND embedding_profile=$4 AND record_kind=$5 AND employee_id IS NOT DISTINCT FROM $6::uuid AND active AND media_type='application/pdf'`,[org,input.hash,input.audience,input.profile,input.recordKind,input.employeeId])).rows[0];
    if(previous)return previous.id;
    const id = (await this.sql.query<{ id: string }>(`INSERT INTO people_cms.documents(organization_id,title,filename,audience,uploaded_by,content_hash,media_type,page_count,embedding_profile,record_kind,employee_id)
      VALUES($1,$2,$3,$4,$5,$6,'application/pdf',$7,$8,$9,$10) RETURNING id`, [org, input.filename.replace(/\.pdf$/i, ''), input.filename, input.audience, actor, input.hash, input.pageCount, input.profile,input.recordKind,input.employeeId])).rows[0]!.id;
    for (const p of input.passages) {
      await this.sql.query(`INSERT INTO people_cms.document_passages(organization_id,document_id,ordinal,page_number,line_start,line_end,content,embedding,embedding_profile)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::vector,$9)`, [org,id,p.ordinal,p.pageNumber,p.lineStart,p.lineEnd,p.text,JSON.stringify(p.embedding),input.profile]);
    }
    await this.sql.query('UPDATE people_cms.organizations SET policy_revision=policy_revision+1 WHERE id=$1', [org]);
    return id;
  }
  async semanticPassages(org: string, role: PeopleRole, profile: string, vector: number[], actorId?: string): Promise<RagPassage[]> {
    // Materialization forces authorization before nearest-neighbor ranking for this exact-search baseline.
    return (await this.sql.query<RagPassage>(`WITH authorized AS MATERIALIZED (
      SELECT ${FIELDS},p.embedding ${JOIN} WHERE ${permit('$5')} AND p.embedding_profile=$3 AND p.embedding IS NOT NULL
      ) SELECT "documentId",title,ordinal,"pageNumber","lineStart","lineEnd",content,"recordKind","employeeId" FROM authorized
      ORDER BY embedding <=> $4::vector,"documentId",ordinal LIMIT 8`, [org,role,profile,JSON.stringify(vector),actorId??null])).rows;
  }
  async lexicalPassages(org: string, role: PeopleRole, query: string, actorId?: string): Promise<RagPassage[]> {
    return (await this.sql.query<RagPassage>(`SELECT ${FIELDS} ${JOIN} WHERE ${permit('$4')}
      AND to_tsvector('simple',p.content) @@ to_tsquery('simple',$3)
      ORDER BY ts_rank_cd(to_tsvector('simple',p.content),to_tsquery('simple',$3)) DESC,p.document_id,p.ordinal LIMIT 8`, [org,role,query,actorId??null])).rows;
  }
  async sources(org: string, role: PeopleRole, keys: SourceKey[], actorId?: string): Promise<RagPassage[]> {
    if (!keys.length) return [];
    return (await this.sql.query<RagPassage>(`SELECT ${FIELDS} ${JOIN} WHERE ${permit('$4')} AND EXISTS (
      SELECT 1 FROM jsonb_to_recordset($3::jsonb) AS wanted("documentId" uuid,ordinal integer)
      WHERE wanted."documentId"=p.document_id AND wanted.ordinal=p.ordinal) ORDER BY p.document_id,p.ordinal`, [org,role,JSON.stringify(keys),actorId??null])).rows;
  }
  async cached(s: CacheScope, semantic: boolean): Promise<{ kind: 'exact' | 'semantic'; sources: SourceKey[] } | null> {
    const row = (await this.sql.query<{ exact: boolean; sources: SourceKey[] }>(`SELECT question_hash=$7 AS exact,selected_sources AS sources
      FROM people_cms.policy_cache WHERE organization_id=$1 AND actor_id=$2 AND role=$3 AND policy_revision=$4
      AND embedding_profile=$5 AND model=$6 AND expires_at>clock_timestamp()
      AND (question_hash=$7 OR ($10 AND question_fingerprint=$8 AND question_embedding <=> $9::vector < 0.005))
      ORDER BY (question_hash=$7) DESC,question_embedding <=> $9::vector LIMIT 1`,
    [s.organizationId,s.actorId,s.role,s.revision,s.profile,s.model,s.questionHash,s.fingerprint,JSON.stringify(s.vector),semantic])).rows[0];
    return row ? { kind: row.exact ? 'exact' : 'semantic', sources: row.sources } : null;
  }
  async cache(s: CacheScope, sources: SourceKey[]): Promise<void> {
    if (!sources.length) return;
    await this.sql.query('DELETE FROM people_cms.policy_cache WHERE expires_at<=clock_timestamp()');
    await this.sql.query(`INSERT INTO people_cms.policy_cache(organization_id,actor_id,role,policy_revision,embedding_profile,model,question_hash,question_fingerprint,question_embedding,selected_sources)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,$10::jsonb)
      ON CONFLICT(organization_id,actor_id,role,policy_revision,embedding_profile,model,question_hash)
      DO UPDATE SET selected_sources=EXCLUDED.selected_sources,expires_at=clock_timestamp()+interval '5 minutes'`,
    [s.organizationId,s.actorId,s.role,s.revision,s.profile,s.model,s.questionHash,s.fingerprint,JSON.stringify(s.vector),JSON.stringify(sources)]);
  }
  async recordRun(r: PolicyRun): Promise<void> {
    await this.sql.query(`INSERT INTO people_cms.policy_runs(request_id,organization_id,actor_id,operation,outcome,model,embedding_profile,cache_kind,source_count,retrieval_ms,inference_ms,total_ms)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [r.requestId,r.organizationId,r.actorId,r.operation,r.outcome,r.model??null,r.profile??null,r.cacheKind??null,r.sourceCount,r.retrievalMs??null,r.inferenceMs??null,r.totalMs]);
  }
  async statistics(org: string): Promise<unknown> {
    const summary = (await this.sql.query(`SELECT count(*)::integer AS runs,
      count(*) FILTER(WHERE outcome='error')::integer AS errors,
      count(*) FILTER(WHERE cache_kind IN ('exact','semantic'))::integer AS "cacheHits",
      percentile_cont(0.5) WITHIN GROUP(ORDER BY total_ms) AS "medianTotalMs"
      FROM people_cms.policy_runs WHERE organization_id=$1 AND created_at>clock_timestamp()-interval '24 hours'`, [org])).rows[0];
    const recent = (await this.sql.query(`SELECT request_id AS "requestId",operation,outcome,model,embedding_profile AS "embeddingProfile",cache_kind AS "cacheKind",
      source_count AS "sourceCount",retrieval_ms AS "retrievalMs",inference_ms AS "inferenceMs",total_ms AS "totalMs",created_at AS "createdAt"
      FROM people_cms.policy_runs WHERE organization_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30`, [org])).rows;
    return { summary, recent };
  }
}
