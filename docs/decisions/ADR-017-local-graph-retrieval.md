# ADR-017: Scoped local retrieval over published context graphs

- **Status:** Implemented as a local operator baseline; Phase 6 remains incomplete.
- **Date:** 2026-11-04

## Problem

Phase 5 made graph generations durable, but there was no query path over PostgreSQL. The in-memory scanner search could not inspect a previously published generation or pin one consistent graph revision.

## Constraints

The graph stores structured facts, attributes, relative source references and hashes. Eligible text from whole-file-secret-screened files is stored as bounded chunks; embeddings and semantic search are not implemented. The CLI scope IDs are supplied by the local operator; there is no project membership or source-level ACL model. Shared APIs, browser chat and production Hermes access remain gated on identity and authorization.

## Options

1. Search names/JSON attributes and source chunks inside the current published generation, then expand a small number of same-generation edges.
2. Add pgvector semantic search before selecting and evaluating an embedding model.
3. Expose retrieval to NestJS and agents before implementing authorization.

## Decision

Implement option 1 as `context storage search`. Validate all UUIDs and query limits, assume the restricted `context_runtime` role, set transaction-local tenant/project/environment scope, resolve the current published head, and filter every result, chunk and relationship by that scope and generation. Use a repeatable-read transaction so a concurrent rollback/deletion cannot mix snapshots across head, nodes, chunks and edges. Search graph metadata with parameterized literal matching and chunks with scoped PostgreSQL full-text plus literal substring search. Return deterministic ordinal ranks and match kinds, not probability-like scores. Include source path/hash/line ranges and the bounded chunk text.

The scanner re-reads the selected root at index time and requires its graph to equal the artifact before persisting chunk text. Chunk candidates are bounded to 4,000 characters, 300-character overlap, 20,000 chunks, and 16 MiB total chunk content. The CLI remains a local operator capability. It is not an authenticated project API and it does not inject retrieved results into local chat or Hermes. The response labels semantic search unavailable. Chunk text is private repository content; heuristic secret screening is not a guarantee that all sensitive values are removed.

## Edge cases and failure behavior

- Invalid UUID, empty/oversized query, and result limits outside 1–20 fail before connecting to PostgreSQL.
- An environment with no published head returns `no_published_generation` and no candidates.
- A database error becomes a generic storage error; connection details and SQL text are not returned.
- A query containing SQL wildcards is escaped and treated literally.
- A graph with partial analyzer coverage returns its actual generation status; retrieval cannot make unsupported files appear complete.
- Chunk artifacts are re-created from the selected root at index time; edited artifact text is not trusted for persistence.
- A full-file secret finding excludes that file before chunking; chunk limits mark the scan partial rather than silently dropping coverage.
- Each relationship lookup pins the same generation and scope as its source result. Neighbor expansion is bounded to five relationships per result.
- Chunk full-text search can fall back to literal substring matching for code identifiers. Matching JSON attributes uses a scoped text scan. Large generations may have high latency; no latency or throughput claim is made.

## Security and privacy

Queries are local-only and read-only. RLS scope and explicit predicates both constrain every statement; only `context_runtime` is used. The local database owner can bypass RLS, and caller-provided UUIDs are not authentication. The scanner excludes files with detected secret patterns but no static detector guarantees absence of credentials or customer data. Stored chunks expose project source and must be protected as private code. Never expose this CLI flow as an application or remote endpoint without verified user membership, source-label authorization, signed internal scope, and authorization tests.

## Observability and recovery

The command returns the actual generation identifier and coverage status. It emits no fabricated match confidence, latency, token, or vector metric. Retrieval has no durable side effects, so retrying after an interrupted client call is safe. Database outage and large-corpus behavior were not exercised for this change.

## Tradeoffs and scale pressure

This provides a useful structured/full-text baseline without choosing an embedding model. PostgreSQL stores bounded chunk excerpts alongside graph metadata, so disk usage and private-data exposure increase. JSON substring search and graph expansion can become expensive; measure query plans and corpus size before adding indexes. Semantic/hybrid retrieval requires a versioned embedding profile, ACL filters inside each candidate query, and a judged evaluation set. A separate vector database is not justified before those measurements.

## Learning and interview questions

- **Problem solved:** make persisted project facts queryable after the indexing process exits.
- **Internal flow:** screen and chunk eligible files, re-scan at index time, checkpoint chunks with graph facts, pin the published generation, search scoped chunks/facts, and expand bounded edges.
- **Failure/recovery:** no head is an explicit empty state; database errors fail the command; reads can be retried safely.
- **Bottleneck:** chunk storage, full-text/substring search and bounded edge joins; no load test exists.
- **Alternatives:** PostgreSQL full-text, pgvector, a search service, or a graph database. The selected baseline uses existing data and dependencies while relevance is still unmeasured.
- **10× change:** add model-versioned embeddings only after held-out quality and latency comparisons; add ACL-aware indexed predicates before broadening access.
- **Interview question:** How can a system prove that a result came from one authorized, consistent project revision when indexing publishes concurrently?

## Verification

Implementation was not exercised against PostgreSQL in this change. No automated tests or load tests were run. The migration, SQL queries, content persistence, and local single-operator limitation require runtime and isolation verification before this baseline can be called a completed retrieval phase.
