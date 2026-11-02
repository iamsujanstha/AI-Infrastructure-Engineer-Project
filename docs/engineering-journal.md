# Engineering Journal

Record observed engineering lessons, not intended outcomes. For each significant implementation or controlled incident, capture the initial assumption, evidence, implementation, failure and root cause (if any), fix, architectural lesson, and interview lesson.

## 2026-11-02 — Phase 0: establish the contract

- **Problem:** Begin a long-lived AI infrastructure project without an existing repository structure or implementation.
- **What I initially thought:** The brief's target architecture could be treated as the current design.
- **What actually happens:** The checkout was empty and had no Git repository. The architecture is therefore a direction, not evidence of running components or settled technology decisions.
- **Implementation:** Added repository guidance, a status-aware README, a system overview with the key state distinctions, and this journal. Kept runtime code and technology-specific commitments out of this phase.
- **Failure encountered / root cause / fix:** None observed.
- **Architectural lesson:** A roadmap is not an implementation. Marking target components separately from verified behavior prevents documentation from creating false operational confidence.
- **Interview lesson:** Explain the difference between an intended architecture, an ADR, and an implemented and tested system; support reliability claims with evidence.

## 2026-11-02 — Phase 1: local foundation

- **Problem:** Provide a runnable control plane and API with dependency health, startup configuration, request correlation, and local PostgreSQL/Redis services.
- **What I initially thought:** The system could defer ORM and migrations until the data-model phase while using a low-level pool for the first health probe.
- **What actually happens:** The initial brief named Prisma, so the first foundation used Prisma 7 and a Prisma migration baseline. After reviewing the tradeoffs, the project owner chose direct `pg` access to keep SQL, pool behavior, and transactions visible for the stated learning goals.
- **Implementation:** Added Next.js/React/Tailwind web control surface, NestJS API, Zod startup validation, Pino structured logs, request IDs, safe exception mapping, API versioning, CORS/body/rate limits, PostgreSQL readiness through a shared `pg.Pool`, Redis readiness through a lazy client, graceful resource shutdown, Compose dependencies, and a checked-in SQL migration runner. Replaced Prisma in application code and dependencies before domain tables existed; retained the old local migration metadata table rather than deleting database state.
- **Failure encountered:** TypeScript exposed an intersection type error when normalizing the CORS origins setting; changed the environment type to omit and replace the parsed field. Turbopack attempted a process/port operation blocked by the sandbox; selecting Next's Webpack build path produced a successful build without weakening the app's runtime permissions. The first live route probe also showed that version-neutral controllers still inherited Nest's global prefix; explicit health-route exclusions corrected the paths. A first pass through the exception filter hid safe `not_configured` health metadata; readiness now returns a classified response and is logged as a warning.
- **Root cause / fix:** The CORS parser's input and output representations differ (`string` to `string[]`), so an intersection retained the incompatible string member. The build failure was environmental rather than a CSS/application error. Nest's global prefix is independent of route version neutrality, so operational paths needed explicit exclusions.
- **Verification evidence:** The original Prisma migration installed pgvector. The replacement `pg` runner then independently recorded and reapplied the extension migration without dropping data. Live checks returned 200 for liveness, PostgreSQL, Redis, and `/api/v1`; inference returned 503 with `not_configured` as expected. Lint, typecheck, 11 unit tests, and both production builds passed. API/web development servers bind to loopback by default because authentication is not part of this phase.
- **Architectural lesson:** Separate operational probes from domain schema design. A checked-in migration can establish an extension prerequisite now, while Phase 2 can still design domain tables from explicit access patterns. Verify framework route behavior through HTTP, not just the controller metadata or application logs. A custom migration runner is operational code with concurrency, integrity, and recovery obligations; raw SQL alone does not remove those responsibilities.
- **Interview lesson:** Explain why liveness should remain healthy during a dependency outage, why a local in-memory limiter does not enforce a global quota, how to hold one pool client for a transaction, and how an advisory lock plus checksums make migration deploys safer.
