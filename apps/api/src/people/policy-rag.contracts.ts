import type { PeopleRole, Person } from './people.contracts';

export interface PdfPassage {
  ordinal: number; pageNumber: number; lineStart: number; lineEnd: number; text: string; embedding: number[];
}
export interface RagPassage {
  documentId: string; title: string; ordinal: number; pageNumber: number | null; lineStart: number; lineEnd: number; content: string; recordKind?: 'policy' | 'salary' | 'leave'; employeeId?: string | null;
}
export interface PolicyCompute {
  indexPdf(bytes: Uint8Array, actor: Person, requestId: string): Promise<{ profile: string; pageCount: number; passages: PdfPassage[] }>;
  embed(question: string, actor: Person, requestId: string): Promise<{ profile: string; vector: number[] }>;
}
export interface CacheScope {
  organizationId: string; actorId: string; role: PeopleRole; revision: string; profile: string; model: string;
  questionHash: string; fingerprint: string; vector: number[];
}
export interface SourceKey { documentId: string; ordinal: number }
export interface PolicyRun {
  requestId: string; organizationId: string; actorId: string; operation: 'pdf_index' | 'policy_answer';
  outcome: 'ok' | 'not_found' | 'error'; model?: string; profile?: string;
  cacheKind?: 'miss' | 'exact' | 'semantic'; sourceCount: number; retrievalMs?: number; inferenceMs?: number; totalMs: number;
}
export interface RagQueries {
  policyRevision(org: string): Promise<string>;
  createPdf(org: string, actor: string, input: { filename: string; audience: string; hash: string; profile: string; pageCount: number; passages: PdfPassage[]; recordKind: 'policy'|'salary'|'leave'; employeeId: string|null }): Promise<string>;
  semanticPassages(org: string, role: PeopleRole, profile: string, vector: number[], actorId?: string): Promise<RagPassage[]>;
  lexicalPassages(org: string, role: PeopleRole, query: string, actorId?: string): Promise<RagPassage[]>;
  cached(scope: CacheScope, semantic: boolean): Promise<{ kind: 'exact' | 'semantic'; sources: SourceKey[] } | null>;
  cache(scope: CacheScope, sources: SourceKey[]): Promise<void>;
  sources(org: string, role: PeopleRole, keys: SourceKey[], actorId?: string): Promise<RagPassage[]>;
  recordRun(run: PolicyRun): Promise<void>;
  statistics(org: string): Promise<unknown>;
}
export interface PolicyRagConfig { smallModel: string; largeModel: string; semanticCache: boolean }
