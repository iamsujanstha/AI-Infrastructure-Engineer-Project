# NestJS Architecture

## Why a modular monolith

Conversation, context, memory, authorization, and model orchestration will share transactional data and change rapidly while the domain is being learned. A single NestJS process with capability modules keeps calls in-process and deployment small while still exposing explicit boundaries. Splitting now would add network failure modes, duplicated deployment work, and distributed consistency problems without a measured scaling or ownership need.

Nest modules are an organizational boundary, not a security boundary. Future modules should export application services and contracts rather than repositories or vendor clients. Controllers handle HTTP mapping; application services own use-case policy; repositories own persistence. Provider-specific data stays behind adapters.

## Phase 1 runtime shape

- `ConfigurationModule` validates environment at startup with Zod.
- `DatabaseModule` owns the PostgreSQL `pg.Pool`, health query, idle-client error handling, and shutdown lifecycle.
- `RedisModule` owns a lazy Redis client and its shutdown lifecycle.
- `HealthModule` exposes liveness and dependency readiness without returning connection strings or raw errors.
- `main.ts` configures versioning, request IDs, JSON logs, security headers, CORS, body limits, and request rate limits.

The API uses `/api/v1` for versioned application routes. Operational probes are version-neutral at `/health`, `/health/database`, `/health/redis`, and `/health/inference`. The global exception filter returns a request ID and safe message; unexpected errors do not disclose stack traces or internal host details to clients.

## Alternatives and tradeoffs

| Choice | Alternative | Reason and cost |
| --- | --- | --- |
| NestJS modules in one process | Separate services from day one | Fewer network hops and operational components; scaling and failure isolation are process-wide for now. |
| Raw parameterized SQL through `pg` | TypeORM or Prisma | Keeping query text and transaction boundaries visible supports this project's SQL and consistency learning goals and fits pgvector directly. Row mapping and compile-time query guarantees become team responsibilities. There are no domain repositories yet. |
| `ioredis` client for readiness only | Redis-backed cache/queue now | Redis has a concrete Phase 1 connectivity requirement; queue semantics belong to a later phase. |
| Zod configuration parsing | Unvalidated `process.env` reads | Startup fails with field-level validation instead of later undefined behavior. |
| Express rate limit in memory | Redis-backed distributed limiter | Smallest local foundation; limits are per process and reset on restart, so this is not suitable as a multi-replica production guarantee. |
| URI API versioning | Header or media-type versioning | Visible and easy to test; route evolution has a stable prefix. |

## Failure, consistency, and scaling

The API starts without eagerly opening database and Redis connections so it can expose liveness during a dependency outage. Readiness probes perform a real `SELECT 1`, `PING`, or configured inference health request. Dependency failure returns `503`; details are intentionally omitted. This is not connection-pool monitoring or a complete dependency SLO.

The connection pool is process-local. If the API is replicated, total possible database connections are approximately replica count multiplied by pool maximum; connection pooling infrastructure and a global budget will be needed before scaling replicas. Redis and database operations will need explicit timeouts and bounded retries in their use cases. Phase 1 has no cross-service transaction, durable queue, or exactly-once guarantee.

Graceful shutdown uses Nest lifecycle hooks to stop accepting requests and close the PostgreSQL/Redis clients. A forced termination may interrupt in-flight requests; request durability and retry semantics belong to their later owning workflows.

## Security and observability

The API binds to loopback by default because Phase 1 has no authentication; change `API_HOST` only when the network boundary is understood. PostgreSQL and Redis ports in Compose also bind only to loopback. CORS is an exact configured origin allowlist; it is not authentication. Helmet adds security headers, request bodies are limited to 64 KiB, and errors are sanitized. Production config rejects sample DB credentials and requires authenticated Redis via password or TLS. Production deployment still needs network policy, TLS termination, authentication/authorization, secret management, and a trusted-proxy decision.

Pino emits JSON logs and redacts authorization and cookie headers. A bounded request ID is accepted only when it matches a safe character/length rule; otherwise the server generates a UUID. The ID is returned in `x-request-id` and included in logs/errors. Request ID is correlation metadata, never an identity or authorization claim.

## Interview prompts

- Why is a Nest module not a microservice or a security boundary?
- How would you bound total PostgreSQL connections across multiple API replicas?
- Why can liveness succeed while readiness fails?
- What guarantees are missing from an in-memory rate limiter behind multiple replicas?
- What must be true before trusting `X-Forwarded-For` or enabling proxy trust?
- How can a request ID be useful without allowing arbitrary high-cardinality metric labels?
