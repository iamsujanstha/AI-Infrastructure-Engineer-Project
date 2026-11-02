# ADR-003: Use Raw PostgreSQL Through `pg`

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

The platform's highest-value learning areas include SQL, data modeling, transactions, connection pooling, and query plans. PostgreSQL-specific features, especially pgvector, are central. At the time of this decision, the core domain schema had not been added, so persistence could be changed without rewriting application repositories. Phase 2 now defines that schema in SQL migrations.

## Decision

Use Node's `pg` package directly for PostgreSQL connectivity and parameterized SQL. Keep pool ownership in the database module and future query composition in capability-owned repositories. Application services own use-case transaction boundaries. Add a small checked-in SQL migration runner rather than introducing an ORM migration subsystem.

## Alternatives considered

- **TypeORM:** Integrates naturally with Nest and offers entity mapping, but adds decorators, identity-map/lifecycle behavior, and query abstraction to learn and debug. Raw SQL remains necessary for some PostgreSQL-specific features.
- **Prisma:** Provides generated contracts and migrations, but adds schema generation and a second abstraction from the actual SQL. The project has no domain model yet, and direct PostgreSQL work is an explicit learning goal.
- **Handwritten SQL without a pool or migration history:** Fewer dependencies, but unsafe connection management and untracked schema changes would undermine reliability.

## Consequences and tradeoffs

- SQL, indexes, transaction isolation, locking, and query plans remain visible and reviewable.
- The team owns SQL parameterization, result-row mapping, transaction rollback, and query-specific typing. Repository interfaces should contain this work without hiding the SQL itself.
- A shared `pg.Pool` bounds connections per process; total capacity must account for every API replica and other clients.
- The custom runner sorts numbered SQL files, obtains a nonblocking advisory lock, tracks SHA-256 checksums, rejects changed or missing applied files, and runs one migration per transaction.
- Transactional migrations are supported. Nontransactional operations such as `CREATE INDEX CONCURRENTLY` require an explicit migration mode before they are introduced.

## Failure and recovery

Each migration either commits both its schema changes and ledger row or rolls back both. A failed rollback destroys the client connection. A concurrent runner fails fast rather than racing. An operator must investigate a failed migration and restore a known schema state; the runner intentionally does not rewrite history or auto-repair checksums.

## Security and observability

Connection strings stay in validated server configuration. All dynamic query values must be parameterized; identifiers cannot be parameterized and must come from static allowlists. The pool logs only idle-client error classes, not connection strings or SQL values. Migration logs identify applied file names but omit database error details that could contain sensitive configuration.

## Interview prompts

- What does `pool.query` do differently from a transaction pinned to one client?
- Why must every transaction use one checked-out client for `BEGIN`, statements, and `COMMIT`?
- How can SQL injection still occur when using a driver with parameter binding?
- What is the difference between advisory locks, row locks, and migration ledger checksums?
- How would you migrate a large table with no downtime when the runner currently wraps every file in a transaction?
- What is the first connection-pool limit when the API scales to several replicas?
