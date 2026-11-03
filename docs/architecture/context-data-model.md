# Proposed project-context data model

Design only: no DDL has been applied. Add new tables in context_platform using the existing SQL runner; do not modify applied migrations. A separate schema isolates the new product from legacy conversation tables.

| Group | Proposed entities and key invariants |
| --- | --- |
| Control | organizations (tenant root), organization_memberships, projects, project_memberships, project_environments, integration_credentials; project belongs to exactly one organization |
| Source | sources (stable normalized relative path), source_versions (sanitized hash, raw digest metadata, parser/redaction version, source revision), documents |
| Analysis | context_nodes, node_source_references, context_relationships, api_operations, database_entities, dependencies |
| Index | scan_runs, scan_items, index_runs, index_generations, context_chunks, context_embeddings |
| Security | security_findings storing rule/category/location/severity only; source access labels; audit_events |
| Retrieval | retrieval_queries and retrieval_results recording authorized IDs, algorithm versions, timings and optional consented query text; no prompts/source text in ordinary logs |

Every project-owned row carries tenant_id and project_id. Environment-specific rows also carry environment_id. Organization membership itself has tenant scope, not a fictional project. Use UUID keys plus composite uniqueness (tenant_id, project_id, id); composite FKs enforce matching scope for every edge, source version, chunk, embedding, run, API operation and database entity. Environment FK includes tenant/project. Mandatory NOT NULL scope, indexes beginning with scope, and RLS provide independent safeguards; test with non-owner database roles.

Existing public.projects is user-owned. Do not add nullable tenant IDs and claim isolation; use new product tables with a documented optional future import. Legacy embeddings have owner/source semantics incompatible with project indexes, so they are not reused as context embeddings.

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

Chunks retain project/source/node/range/hash/type and access label. Embed only sanitized allowed chunks. Record model/revision, dimension, distance metric, input hash and embedding configuration. Do not mix incompatible vector spaces. No ANN index or dimension is selected before Phase 6 evaluation; support typed partitions/expression indexes per selected model if needed.

Unique indexing identity: tenant/project/environment + source revision/manifest digest + analyzer/redaction/chunker/embedding versions + idempotency key. Same key with another digest is 409. A single project/environment publication lease uses fencing tokens. Work is checkpointed per source and stage; a crashed worker resumes completed items without double-publishing. Readers pin one published immutable generation; a partial generation is never the default. Removing a source creates a tombstone in the next generation. Garbage collection respects retained generations and audit retention; deletion removes text, chunks and vectors together under an explicit policy.

