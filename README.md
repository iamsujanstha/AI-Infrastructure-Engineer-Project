# AI Project Context Platform

A secure platform that discovers existing software projects, structures their source knowledge, retrieves permission-aware context, and compiles cited context for consuming agents. Atlas Commerce is the first intended real integration.

The active brief starts a new Phase 0–10 sequence. Phase 0 is documented in the [architecture proposal](docs/architecture/system.md), with [service boundaries](docs/architecture/service-boundaries.md), [data model](docs/architecture/context-data-model.md), [API contract](docs/architecture/context-api.md), and [threat model](docs/security/threat-model.md). NestJS owns the control/integration plane; FastAPI will own context computation. Hermes, MLX and Qwen are future integration work after V1 context retrieval and evaluation pass.

Phase 1 adds a locked Python 3.12/FastAPI runtime, authenticated internal health calls, request/trace propagation, a bounded NestJS client, Compose packaging and repeatable outage/recovery experiments. See [foundation setup and verification](docs/infrastructure/context-engine-foundation.md). PostgreSQL/pgvector, the raw-pg migration runner and earlier conversation persistence remain available. Redis is optional under the legacy Compose profile. CLI/SDK, scanner, analyzers, graph, retrieval and project authorization are not implemented yet; no shared context APIs are exposed. The earlier laboratory roadmap is historical and superseded by the new implementation order.

## Core distinctions

Phase 2 adds the local [project scanner and CLI](docs/context/project-scanner.md): build the CLI, then run `npm run context -- init --root /path/to/project --name project-name` and `npm run context -- scan --root /path/to/project`. It produces real discovery/provenance with bounded reads and secret exclusions. Module/API/entity analysis remains Phase 3 work.

```text
Persistent memory ≠ conversation history ≠ retrieved context ≠ inference context window
```

Logical knowledge may grow over time. Each individual inference request must remain within the selected model's context limit, with output capacity reserved. Context limits are managed; they are not removed.

## Previous implementation record

Phases 0–1 established the engineering contract and runnable web/API foundation. Phase 2 added the PostgreSQL core schema, scope-safe relational constraints, query indexes, pgvector storage, and a checked-in SQL migration runner using raw `pg`. Phase 3 added owner-scoped conversation and message persistence, partial assistant output, terminal outcomes, retry/regeneration lineage, and branch snapshots. Provider inference, token budgeting, authenticated HTTP routes, and client streaming are future phases. The current state and staged AI Systems Laboratory migration are documented in the [assessment and migration plan](docs/architecture/ai-systems-laboratory-plan.md). See [local development](docs/infrastructure/local-development.md), the [database model](docs/database/data-model.md), and the [request lifecycle](docs/architecture/request-lifecycle.md).

## Previous architecture direction (historical)

Begin with a modular monolith and explicit provider/agent interfaces. PostgreSQL is the durable system of record; Redis is provisioned for later jobs, and pgvector is installed for later retrieval work. Queue semantics and inference adapters will be implemented only when their phases define the required contracts. Keep local inference independently configurable so the control plane does not depend on one host or model.

See [the system overview](docs/architecture/system-overview.md), [the AI Systems Laboratory assessment and migration plan](docs/architecture/ai-systems-laboratory-plan.md), [the engineering contract](AGENTS.md), and [the engineering journal](docs/engineering-journal.md).

## Phased delivery

Follow the active brief: architecture, foundation, scanner, analyzers, context graph, storage, retrieval, compiler, evaluation, real Atlas integration, and only then future agent integration. Complete and review one phase before starting the next. Retain the earlier implementation record as evidence, not as the current roadmap.

For any completed phase, report what exists, what was verified, what remains unverified, the decision tradeoffs, and the next proposed phase. Do not infer completion from this roadmap.

## Local development

See [local development](docs/infrastructure/local-development.md) for prerequisites, configuration, startup, readiness, and verification commands. Never put real credentials in the repository.

## Learning approach

For major subsystems, explain the problem, constraints, design, alternatives, failure behavior, scaling pressure, consistency guarantees, security implications, observability, and interview-level reasoning. Record actual implementation lessons and incidents in the engineering journal; do not fabricate operational evidence.
