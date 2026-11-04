# AI Project Context Platform

A secure platform that discovers existing software projects, structures their source knowledge, retrieves permission-aware context, and compiles cited context for consuming agents. Atlas Commerce is the first intended real integration.

The active brief starts a new Phase 0–10 sequence. Phase 0 is documented in the [architecture proposal](docs/architecture/system.md), with [service boundaries](docs/architecture/service-boundaries.md), [data model](docs/architecture/context-data-model.md), [API contract](docs/architecture/context-api.md), and [threat model](docs/security/threat-model.md). NestJS owns the control/integration plane; FastAPI is the context-computation runtime. The home page provides local MLX chat through a replaceable inference-provider port and persists conversation history in PostgreSQL. This is a local single-user prototype, not authenticated access. It is raw generation: project sources are not attached, and replies must not be treated as project-grounded. A local Hermes MCP bridge can read screened project evidence, but it is separate from browser chat. Reusable FDE integration follows durable project storage, scoped retrieval, cited context compilation, evaluation and identity.

For a practical walkthrough of the tools, ports, PostgreSQL/pgvector queries, Hermes storage, current flows and next implementation phases, read the [Local Platform Guide](docs/guides/local-platform-guide.md).

Phase 1 adds a locked Python 3.12/FastAPI runtime, authenticated internal health calls, request/trace propagation, a bounded NestJS client, Compose packaging and repeatable outage/recovery experiments. See [foundation setup and verification](docs/infrastructure/context-engine-foundation.md). PostgreSQL/pgvector and the raw-pg migration runner support existing conversation persistence and context storage. Redis is optional under the legacy Compose profile. The local scanner, analyzers and graph artifact are implemented. Phase 5 adds local scoped graph storage; the Phase 6 local retrieval baseline stores screened chunks and searches published graph facts plus source excerpts with provenance. See [storage operations](docs/context/storage-operations.md). Semantic/hybrid retrieval, source ACLs, context compilation, and browser-chat/Hermes integration remain open. The earlier laboratory roadmap is historical and superseded by the new implementation order.

## Core distinctions

Phase 2 adds the local [project scanner and CLI](docs/context/project-scanner.md): build the CLI, then run `npm run context -- init --root /path/to/project --name project-name` and `npm run context -- scan --root /path/to/project`. It produces bounded discovery/provenance with secret exclusions. Phase 3 adds [static analyzers](docs/context/analyzers.md) for source structure, REST/GraphQL/OpenAPI, PostgreSQL DDL, documentation and dependency declarations. Phase 4 builds a [versioned local context graph](docs/architecture/context-graph.md) with bounded find and adjacency queries. Phase 5 adds local PostgreSQL persistence of these graph artifacts. Unsupported or failed files remain explicit.

### Persisting a local graph artifact

Regenerate the Python dependency lock with `cd apps/context-engine && uv lock`, apply SQL migrations with `npm run db:migrate -w @local-ai/api`, and ensure `DATABASE_URL` is set. Then:

```sh
npm run context -- scan --root /path/to/project --output /tmp/project-scan.json
npm run context -- index --artifact /tmp/project-scan.json --root /path/to/project --tenant-id "$(uuidgen)" --environment-id "$(uuidgen)" --environment-name local
```

Reuse the same tenant and environment UUIDs for later scans of this scope. Project UUID comes from `.context-platform.json`. Batches checkpoint independently; only the final transaction changes the published head. An identical repeat reports `already_published`. Read the [storage operations guide](docs/context/storage-operations.md), [implemented data model](docs/architecture/context-data-model.md), and [ADR-016](docs/decisions/ADR-016-atomic-context-graph-generations.md) for operations and limits. The CLI switches to a restricted runtime role, but the local owner can bypass RLS and caller-supplied UUIDs are not user authentication.

```text
Persistent memory ≠ conversation history ≠ retrieved context ≠ inference context window
```

Logical knowledge may grow over time. Each individual inference request must remain within the selected model's context limit, with output capacity reserved. Context limits are managed; they are not removed.

## Previous implementation record

Phases 0–1 established the engineering contract and runnable web/API foundation. Phase 2 added the PostgreSQL core schema, scope-safe relational constraints, query indexes, pgvector storage, and a checked-in SQL migration runner using raw `pg`. Phase 3 added owner-scoped conversation and message persistence, partial assistant output, terminal outcomes, retry/regeneration lineage, and branch snapshots. The browser now uses those conversation services through a server-owned local development principal; it remains unauthenticated and unconnected to project retrieval. See [local MLX and browser chat](docs/infrastructure/mlx-inference.md), [local development](docs/infrastructure/local-development.md), the [database model](docs/database/data-model.md), and the [request lifecycle](docs/architecture/request-lifecycle.md).

## Previous architecture direction (historical)

Begin with a modular monolith and explicit provider/agent interfaces. PostgreSQL is the durable system of record; Redis is provisioned for later jobs, and pgvector is installed for later retrieval work. Queue semantics and inference adapters will be implemented only when their phases define the required contracts. Keep local inference independently configurable so the control plane does not depend on one host or model.

See [the system overview](docs/architecture/system-overview.md), [the AI Systems Laboratory assessment and migration plan](docs/architecture/ai-systems-laboratory-plan.md), [the engineering contract](AGENTS.md), and [the engineering journal](docs/engineering-journal.md).

## Phased delivery

Follow the active brief: architecture, foundation, scanner, analyzers, context graph, storage, retrieval, compiler, evaluation, real Atlas integration, and only then future agent integration. Complete and review one phase before starting the next. Retain the earlier implementation record as evidence, not as the current roadmap.

For any completed phase, report what exists, what was verified, what remains unverified, the decision tradeoffs, and the next proposed phase. Do not infer completion from this roadmap.

## Local development

See [local development](docs/infrastructure/local-development.md) for prerequisites, configuration, startup, readiness, and verification commands. The formatted service directory is at `http://127.0.0.1:3000/services`; the raw catalog is `http://127.0.0.1:4000/api/v1/system/services`. Interactive API references are at `http://127.0.0.1:4000/docs` (NestJS) and `http://127.0.0.1:8000/docs` (FastAPI); pgAdmin is at `http://127.0.0.1:5050`. Never put real credentials in the repository.

## Learning approach

For major subsystems, explain the problem, constraints, design, alternatives, failure behavior, scaling pressure, consistency guarantees, security implications, observability, and interview-level reasoning. Record actual implementation lessons and incidents in the engineering journal; do not fabricate operational evidence.
