# ADR-016: Persist context graphs as atomic immutable generations

- **Status:** Implemented for local scoped storage; shared identity and retrieval remain deferred.
- **Date:** 2026-11-04

## Problem

The scanner, analyzers and graph builder produce useful, provenance-backed context, but the graph exists only in a local JSON artifact. It disappears from the system of record after the command ends, so a later retrieval service cannot pin a consistent graph version or inspect source-backed facts. Persisting rows one at a time without a publication boundary could expose a half-written graph after a crash.

## Decision

Add an isolated `context_platform` schema and `context index`, `context storage rollback`, and `context storage delete-environment` commands. The operator supplies explicit tenant/environment UUIDs; project UUID comes from the validated graph. PostgreSQL stores scoped projects/environments, sources, graph nodes/edges, immutable generation metadata, 500-row payload-hashed checkpoints and a per-environment head. A NOLOGIN, NOBYPASSRLS runtime role is used for indexing and maintenance; policies enforce transaction-local tenant/project/environment scope. A bounded session advisory lock serializes index/rollback/delete operations in that scope. Batch writes commit checkpoints while the generation remains `building`; final row-count checks and the `published` state/head update happen atomically. The canonical graph hash is the idempotency key. Composite edge FKs prevent cross-scope or cross-generation endpoints.

The existing API SQL migration runner owns schema changes. Existing conversation migrations remain untouched. The context engine uses `psycopg` only in the storage adapter; model-provider and scanner code do not depend on it.

## Why this solves the problem

- PostgreSQL is now the durable source of truth for a graph snapshot rather than the JSON file alone.
- Readers can resolve one head and pin an immutable generation, avoiding mixed-version graph reads.
- The transaction prevents partial generation visibility; retrying the same manifest is idempotent.
- Scope columns and composite foreign keys constrain accidental cross-tenant/project/environment references.
- Keeping this in PostgreSQL avoids adding a graph database before query measurements justify one.
- Checkpoints make interrupted indexing resumable without making staging rows the default graph.
- Explicit rollback and confirmed environment deletion provide recovery and lifecycle controls.

## Alternatives considered

- **Keep local JSON only:** simplest, but no durable shared index or stable generation head.
- **Write each graph row independently:** lower transaction size but permits partial publication and cleanup ambiguity.
- **Store the entire graph in one JSONB document:** easy atomic writes, but poor node/edge constraints and selective query paths.
- **Add a graph database:** adds operational complexity before traversal or query load is measured; PostgreSQL already owns the platform data.
- **Put storage in the Python engine:** keeps locality but would require a second database migration mechanism. The existing SQL runner remains the single schema authority.

## Failure behavior and edge cases

- Invalid UUIDs or graph provenance are rejected before the transaction.
- Missing project/environment rows are created with `ON CONFLICT DO NOTHING`; an existing name is not silently overwritten.
- Duplicate manifest: reuse the already stored generation and repoint the head to it.
- Two indexers for the same scope: advisory transaction lock serializes the publication critical section.
- Failure during insert or head switch: PostgreSQL rolls back all writes; the previous head remains.
- Interruption after a committed batch leaves staging unpublished; retry verifies checkpoint hash/count and resumes.
- A checkpoint mismatch, unexpected row count or 30-second lock timeout fails without moving the head.
- Process crash after commit but before CLI output: retry finds the manifest and reports `already_published`.
- Same generation UUID with a different manifest: unique/primary-key conflict aborts; it cannot mutate an immutable generation.
- Malformed JSON duplicate keys, oversized artifact, stale file during read, invalid edge endpoints, missing provenance and unsupported graph version are rejected by artifact reader/graph validator.
- Partial scanner coverage is retained as `partial` with coverage metadata. Consumers must not mistake it for complete coverage.
- Environment deletion requires exact UUID confirmation and cascades generations, checkpoints and graph rows. Retention and audit policies remain future work.

## Security and limits

Policies use transaction-local tenant/project and environment settings; the restricted runtime role is not a table owner and has no BYPASSRLS. A live scope check returned zero rows for another environment and confirmed graph-node UPDATE/DELETE are denied. The Compose `platform` owner can still bypass RLS, and the CLI accepts caller-supplied IDs without identity membership checks. This is not shared-user authorization and remains a local operator workflow. Relative paths and provenance hashes/ranges avoid copying raw file contents, although names/metadata still reveal repository structure.

Each 500-row batch is a short transaction; a per-environment session lock stays held across batches and publication. This reduces transaction size but a stalled process holds the lock until its connection closes, and contenders fail after 30 seconds. At 10x, measure throughput, WAL, checkpoint growth and lock hold time before introducing fencing-token leases or worker queues. Current graph caps are 75,000 nodes and 150,000 edges; no load benchmark was run.

## Verification and failure experiment

`npm run db:migrate -w @local-ai/api` applied migrations 0006 and 0007 locally; all migrations also applied in a fresh temporary database, which was dropped afterward. Psycopg 3.3.7 is pinned in `uv.lock`; Python syntax compilation passed. A disposable project was indexed twice (publish/idempotent), interrupted after a committed checkpoint and resumed, indexed concurrently by two processes (one publish and one idempotent result), rejected an invalid edge endpoint with SQLSTATE 23503, rolled back to an earlier generation, and deleted by environment. A `context_runtime` scope check observed zero rows in another environment and confirmed no graph-node UPDATE/DELETE grant. Automated test suite and load test were not run.

The migration runner recognizes the exact checksum of the already-applied pre-split 0006 draft in this local database; 0007 reconciles both that schema and a fresh 0006 baseline. The compatibility entry is documented in the runner and remains limited to that single checksum.

Repeatable local experiment:

1. Apply migrations 0006 and 0007 with the existing migration command.
2. Scan a disposable initialized project and index the artifact twice; expect `published` then `already_published`, with one head.
3. Start a second index operation for the same scope; confirm the advisory lock serializes it and the final head references one complete generation.
4. Use `--inject-interruption-after-checkpoints 1`; confirm the generation stays unpublished, then rerun and resume from the durable checkpoint.
5. Alter one edge endpoint to another project/generation; confirm graph validation or composite FK rejects it.
6. Run cross-scope reads/maintenance as `context_runtime`; confirm another environment returns no rows and graph node writes/deletes are denied.
7. Roll back the head, confirm it points at the requested published generation, then delete a disposable environment and confirm cascading cleanup.

## Scale and future changes

At 10x corpus size, measure transaction bytes/duration, WAL, insert throughput, index sizes and graph read patterns. If single-transaction imports become too expensive, introduce staged generation plus per-source checkpoints and a fencing-token publication lease while keeping immutable reader generations. Consider a graph store only if measured traversal/query patterns cannot be served acceptably by scoped PostgreSQL indexes.

## Interview questions

1. Why are composite foreign keys useful even when every API query has a tenant filter?
2. How does an atomic head switch avoid readers observing a partially indexed repository?
3. What does an advisory lock guarantee, and what does it not guarantee?
4. Why does RLS not protect against a table owner or `BYPASSRLS` role?
5. How would you add checkpoints without allowing an incomplete generation to become visible?
