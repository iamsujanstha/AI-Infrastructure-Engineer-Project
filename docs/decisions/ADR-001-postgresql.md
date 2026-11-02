# ADR-001: PostgreSQL as the Durable System of Record

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

The platform needs durable users, projects, conversations, messages, agent runs, memories, documents, model profiles, usage, and audit records. These entities have ownership relationships and use cases that need constraints and multi-record transactions. Semantic retrieval is also required later.

## Decision

Use PostgreSQL as the authoritative durable store and raw `pg` for connection pooling and parameterized SQL. The local foundation uses PostgreSQL 17 with pgvector available. Phase 1 established the SQL migration ledger and enabled the `vector` extension; Phase 2 added core tables, constraints, and indexes. Detailed access patterns and application transaction boundaries still need to be implemented by their owning services.

## Alternatives considered

- **MongoDB:** Flexible document shape is attractive for evolving prompts, but does not remove the need to model ownership, uniqueness, relationship integrity, and cross-record transactions. It also separates the future vector retrieval path from the preferred relational system.
- **TypeORM or Prisma:** Both can reduce mapping boilerplate, but hide some SQL and persistence behavior behind entity/client abstractions. This project prioritizes direct SQL and transaction learning; revisit if mapping overhead becomes a concrete productivity or correctness problem.
- **SQLite:** Excellent for embedded local applications, but would not exercise the intended connection pooling, concurrent API access, PostgreSQL query planning, pgvector, or deployment topology.
- **PostgreSQL plus a separate vector database:** Could isolate vector scaling, but introduces another store and consistency/reconciliation problem before vector workload is measured.

## Consequences and tradeoffs

- Relational constraints and transactions can enforce durable invariants, but schema migrations and query planning become deliberate engineering work.
- PostgreSQL is the source of truth. Redis, vector indexes, and caches must not become hidden authoritative copies without an ADR.
- The first likely scaling limit is connection and query capacity. Each API process owns a pool; replica count multiplied by pool size must fit the database connection budget.
- A database outage makes its readiness endpoint fail; the process remains live. No automatic failover, backup, or restore procedure is implemented yet.
- Raw SQL makes query plans and PostgreSQL-specific behavior visible, but the team owns mapping rows to domain types, query parameterization, and keeping the migration ledger consistent.
- The custom migration runner serializes deploys with an advisory lock, applies each migration in its own transaction, and checks SHA-256 checksums. Migrations using nontransactional DDL need a deliberate runner extension before use.

## Security and observability

Local database ports bind to loopback and credentials come from environment configuration. Production requires secret management, least-privilege roles, network restrictions, backups, and a restore test. Phase 1 readiness runs `SELECT 1`; latency SLOs, pool metrics, query tracing, and audit policy are future work.

## Interview prompts

- Which data belongs in normalized relational tables, and which belongs in immutable event records?
- How would you keep total PostgreSQL connections bounded across multiple API replicas?
- What consistency is lost if memories are stored only in a vector index?
- When would a separate vector database be justified by evidence?
- How would you verify backup recovery rather than merely verify that backups exist?
