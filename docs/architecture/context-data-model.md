# Project-context data model and implementation status

Phase 5 adds migrations `0006_context_graph_storage.sql` and `0007_context_index_checkpoints.sql`; migration `0008_context_source_chunks.sql` adds bounded screened text chunks for the Phase 6 local retrieval baseline. The CLI persists validated graph artifacts and chunks as checkpointed, immutable generations. It supports recovery after an interrupted batch, explicit generation rollback, confirmed environment deletion and scoped lexical/graph search. Identity memberships, authenticated shared APIs, semantic embeddings, ACL labels and context compilation remain open. UUID scope values are identifiers, not proof of caller authorization.

| Group | Proposed entities and key invariants |
| --- | --- |
| Control | `projects` (tenant_id, project_id, name), `environments` (tenant/project/environment); organization membership, project membership and credentials remain future identity work |
| Source | `graph_sources` per generation (source UUID, normalized relative path, content hash, analysis status); `context_chunks` stores bounded text with source hash, chunk hash, relative path, chunker version and source line range. A separate source/version catalog is not implemented |
| Analysis | `graph_nodes` and `graph_edges`, keyed by tenant/project/environment/generation; nodes retain attributes/provenance as JSONB and edge endpoints use scoped composite FKs |
| Index | `graph_generations` records manifest hash, graph version, coverage, counts and building/published state; `index_checkpoints` records 500-row batches; `graph_heads` points at the published immutable generation |
| Security | security_findings storing rule/category/location/severity only; source access labels; audit_events |
| Retrieval | retrieval_queries and retrieval_results recording authorized IDs, algorithm versions, timings and optional consented query text; no prompts/source text in ordinary logs |

Every implemented project-owned row carries tenant_id and project_id; environment-owned rows also carry environment_id. Composite FKs enforce scope for generation, graph rows, head and edge endpoints. The CLI switches to the NOLOGIN, NOBYPASSRLS `context_runtime` role and sets transaction-local tenant/project/environment scope. A live check confirmed that role could not see another environment's rows and could not update/delete graph nodes. The `platform` login can bypass RLS, and the CLI accepts operator-supplied IDs; this is scoped local storage, not authenticated multi-tenant authorization.

Existing public.projects is user-owned. Do not add nullable tenant IDs and claim isolation; use new product tables with a documented optional future import. Legacy embeddings have owner/source semantics incompatible with project indexes, so they are not reused as context embeddings. Chunk text is private repository content. Files detected with credentials are excluded as a whole, but heuristic scanning cannot prove every stored excerpt is free of sensitive data.

~~~mermaid
erDiagram
    ORGANIZATIONS ||--o{ PROJECTS : owns
    PROJECTS ||--o{ PROJECT_ENVIRONMENTS : scopes
    PROJECTS ||--o{ SOURCES : contains
    SOURCES ||--o{ SOURCE_VERSIONS : versions
    SOURCE_VERSIONS ||--o{ NODE_SOURCE_REFERENCES : cites
    CONTEXT_NODES ||--o{ NODE_SOURCE_REFERENCES : supported_by
    CONTEXT_NODES ||--o{ CONTEXT_RELATIONSHIPS : scoped_edges
    CONTEXT_NODES ||--o{ CONTEXT_CHUNKS : describes
    CONTEXT_CHUNKS ||--o{ CONTEXT_EMBEDDINGS : represents
    PROJECTS ||--o{ INDEX_GENERATIONS : publishes
~~~

Provenance includes sourceId, sourceVersionId, relative path, lineStart/lineEnd (1-based inclusive when text), sanitized content hash, repository revision and analyzer version. A file-level fact may omit ranges explicitly; guessed ranges are forbidden. No absolute workstation paths or raw secret evidence in external results.

Node identity is stable within a project by logical source/symbol identity; versioned facts belong to an immutable generation. Rename detection is best-effort and cannot substitute for provenance. Relations include contains/imports/depends_on/calls/exposes/uses/implements/stores/references/documents, with fact kind, evidence and confidence. Cross-project edges are rejected by FK constraints.

The initial `context_chunks` table has lexical GIN indexing but no embedding rows yet. Future embeddings must retain project/source/node/range/hash/type and access label; record model/revision, dimension, distance metric, input hash and embedding configuration. Do not mix incompatible vector spaces. Select model, dimensions and ANN strategy only after Phase 6 retrieval evaluation; typed partitions/expression indexes per selected model remain options.

Idempotency is tenant/project/environment plus a canonical full-graph manifest hash. A session advisory lock serializes work in that scope with a bounded 30-second acquisition wait. Sources, nodes and edges are inserted in 500-row transactions; each batch and its content hash checkpoint commit together. A resumed run verifies existing checkpoint hashes/counts and skips completed batches. The final transaction verifies total row counts, marks the generation published and switches `graph_heads`. A deliberately injected stop after a committed checkpoint was resumed successfully. Readers must select the head and pin its generation; partial graph coverage remains explicit. Source tombstones, retention and garbage collection are not implemented.

