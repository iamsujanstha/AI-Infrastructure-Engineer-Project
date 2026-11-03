# PostgreSQL project scope and immutable publication

- Status: Proposed for implementation; product scope and service split follow the 2026-11-03 brief.
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

## Implementation

Phase 5 additive migrations and scoped Python database repositories; choose Python driver then. Do not edit migrations 0001–0005 or move data in Phase 0.

## Verification

Real non-owner-role cross-scope tests, same-project ACL tests, pool reuse, duplicate/concurrent indexing, crash/resume and source removal.

## Scaling and security

Bound admission and per-project work; measure parser/embedding CPU, database queries and HTTP latency before extraction or broker adoption. Use non-owner database roles, explicit authorization scopes and sanitized telemetry. No runtime or load result is claimed by this ADR.

## Interview question

Why must graph edges and provenance references carry the same scope as chunks?

