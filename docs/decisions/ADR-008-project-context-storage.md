# PostgreSQL project scope and immutable publication

- Status: Local scoped storage and resumable publication implemented by ADR-016; authenticated multi-tenant authorization remains proposed.
- Date: 2026-11-03

## Problem

Context retrieval needs provenance, isolation, coherent versions and incremental recovery.

## Constraints

Existing user-owned schema and applied migrations must remain intact; raw pg stays; Python also needs repositories.

## Failure modes

Owner-only constraints miss tenants; partial publication exposes inconsistent graphs; mixed vector models corrupt retrieval.

## Options

Reuse legacy conversation embeddings; separate vector store; destructive schema rewrite; two independent migration ledgers.

## Tradeoffs

Explicit isolation and reproducible generations; additional scope columns, storage retention and garbage collection complexity.

## Decision

One PostgreSQL store with new context_platform schema, mandatory composite scope FKs/RLS, separate runtime roles, immutable generations and publication fencing. pgvector is derived representation; source versions and graph remain authoritative. One existing SQL runner owns all DDL.

## Implementation status

Migrations 0006–0007 and the local Python storage adapter implement scoped, checkpointed graph generations with a restricted runtime role, rollback and environment deletion. The Python driver is psycopg. Migrations 0001–0005 remain untouched. Organization membership, authenticated project/environment authorization, retention/audit and retrieval tables remain unimplemented. A single historical checksum alias recognizes the pre-split 0006 draft already applied in this local database; migration 0007 reconciles it with clean installs. See [ADR-016](ADR-016-atomic-context-graph-generations.md).

## Verification

Local scope check as `context_runtime`, idempotent and concurrent indexing, interrupted-batch resume, rollback and environment deletion were exercised. Fresh database, malformed-FK, same-project ACL, load, user identity and retention checks remain outstanding.

## Scaling and security

Measure batch throughput, WAL, checkpoint growth and lock hold time before considering worker extraction. Keep authenticated user membership separate from caller-supplied UUID scope. The local owner role can bypass RLS; no shared-service guarantee is claimed.

## Interview question

Why must graph edges and provenance references carry the same scope as chunks?

