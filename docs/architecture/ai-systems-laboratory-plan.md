# AI Systems Laboratory: Current State and Migration Plan

Superseded on 2026-11-03 by the AI Project Context Platform brief. Preserve this assessment as historical evidence. Follow [the active architecture and phase plan](system.md); do not continue the laboratory/inference roadmap below for V1.

## 1. Current architecture assessment

The repository is a NestJS modular monolith with a Next.js control surface. PostgreSQL is the durable store, accessed through `pg.Pool` and checked-in SQL migrations. The schema has 20 domain tables; the conversation module now implements owner-scoped internal services for conversation/message persistence, partial assistant output, retry/regeneration, and branching. Request IDs, structured HTTP logs, startup configuration validation, and health endpoints are implemented.

The implemented system is still a foundation, not an AI runtime. The HTTP API exposes its index and health probes; the conversation services are not exposed over HTTP. Authentication and authorization are absent. Redis is only connected and health-checked; there is no queue/cache behavior. There is no model adapter, context builder, tokenizer, memory retrieval service, agent/tool execution, streaming endpoint, model lifecycle manager, or run trace writer. Several tables reserve schema for future capabilities but are not evidence that those services exist.

## 2. Current UI assessment

The current UI has one responsive page: a large foundation hero, a static milestone card, and four live health checks (API, PostgreSQL, Redis, inference). It has no navigation to engineering workflows, run history, context, memory, models, tools, jobs, incidents, or architecture. The “Phase 1 · Foundation” badge is stale, and the milestone copy says job infrastructure is checked even though only Redis readiness exists.

The checks call real API health endpoints; they are not fabricated metrics. However, the browser showed every dependency as offline while direct API, PostgreSQL, and Redis probes returned healthy. The cause is confirmed: the browser origin is `http://127.0.0.1:3000`, while the default CORS allowlist contains only `http://localhost:3000`; the browser API client also defaults to `http://localhost:4000` while the API binds to IPv4 loopback. The UI maps every fetch/CORS failure to “API unreachable,” so that failure is not distinguishable from a real API outage. The screenshot audit is limited to the current home screen; keyboard navigation, screen-reader announcement behavior, and full accessibility were not exhaustively tested.

## 3. What should remain

- NestJS, PostgreSQL, `pg.Pool`, SQL migration ledger, pgvector, and the existing data constraints.
- Redis Compose service and readiness probe; add queue semantics only with the jobs capability.
- Request correlation, structured logs, configuration validation, safe health endpoints, and current unit/integration tests.
- Conversation persistence and its PostgreSQL integration coverage.
- The compact dark visual language and health checks as the System overview foundation.

## 4. What should be removed

- Remove the stale Phase 1 badge and static “Foundation services” milestone from the home page when it is next redesigned.
- Remove the unsupported claim that job infrastructure is currently checked.
- Do not add empty lab routes, fake “active model”/run/queue data, decorative charts, large marketing-style hero sections, or mock AI responses.
- Do not remove working backend foundations or schema merely to make the UI appear cleaner.

## 5. What should be redesigned

Make the landing page a compact System overview with only current, sourced dependency state and recent activity once an activity source exists. Add workflow views incrementally: the Workspace for real conversations; Runs for persisted execution traces; Context Lab for exact assembled prompt items and budget decisions; Memory Lab for provenance and retrieval explanations; Inference Lab for measured provider phases; Models for observed lifecycle and routing; Tools and Jobs for actual execution state; Incidents for controlled experiments and recovery records; Architecture for responsibilities and dependencies backed by a maintained manifest. No destination should imply a capability that is not implemented.

## 6. Backend capabilities currently missing

- Identity, authentication, authorization, and trusted owner context for HTTP requests.
- Validated, owner-scoped conversation API endpoints.
- Token counting/estimation, model-specific budget policy, context selection/compaction, and persisted context snapshots.
- Provider-neutral model and agent interfaces plus working Hermes/MLX adapters.
- Durable run lifecycle/timeline writes; provider-reported usage and measured queue/prompt/TTFT/generation durations.
- Browser streaming with disconnect propagation and provider cancellation.
- Memory lifecycle APIs, embeddings generation, scoped retrieval/ranking, and a relevance evaluation set.
- Tool registry, schemas, policy/authorization, timeout/resource limits, and audit records.
- BullMQ workers, idempotency/retry policy, and recovery semantics.
- Model lifecycle state, exclusive switching lock, active-run drain, health check, and warm-up.
- Repeatable failure experiments and incident records. Existing database integration tests do not yet cover dependency outage/recovery experiments.
- Metrics/traces and durable recent-activity source. Current request IDs and structured logs are useful foundations, not a run explorer or observability system.

## 7. New information architecture

```text
LOCAL AI PLATFORM
├── Workspace
├── Runs
├── Context Lab
├── Memory Lab
├── Inference Lab
├── Models
├── Tools
├── Jobs
├── Incidents
├── System
└── Architecture
```

Expose each destination only when its underlying service, API contract, tests, and failure behavior exist. The current health checks move under System; the home page remains a concise operational summary.

## 8. Migration plan

1. **Direction and trust baseline:** Record these rules, correct the loopback CORS/API URL mismatch, replace unsupported or stale copy, and keep current health data sourced. No visual redesign yet.
2. **Identity and API boundary:** Add a real identity/authentication design and owner context; expose conversation endpoints only behind server-side authorization. Test unauthenticated, cross-owner, and revoked access.
3. **Token and context engine:** Implement tokenizer/provider-aware estimates, explicit model budgets/output reserve, context assembly, and inspectable inclusion/exclusion reasons. Test overflow, truncation/compaction, and pinned items.
4. **Inference and run lifecycle:** Add provider-neutral contracts and selected local adapters, model registry/routing, durable run timeline, and source-labeled token/time measurements. Test timeout, unavailable provider, malformed provider events, and recovery.
5. **Streaming workspace:** Stream real provider events, persist partial output, propagate browser disconnect/cancel, and expose run/context inspection links. Test disconnect and cancellation races.
6. **Memory and retrieval:** Implement scoped memory lifecycle, embedding generation, retrieval/ranking provenance, and evaluation fixtures before building Memory Lab. Test irrelevant candidates, owner isolation, and embedding-worker failure.
7. **Models, tools, and jobs:** Add model switching/draining, privileged tool execution, and BullMQ semantics behind measured contracts. Test switching during a run, tool denial/timeout, duplicate jobs, and worker loss.
8. **Failure and incident lab:** Add safe, isolated fault controls and incident records with detection, impact, recovery, and verification. Each subsystem ships with a repeatable runbook/experiment before it gets a control.
9. **UI vertical slices:** Build the information architecture as each backend capability becomes usable, rather than scaffolding empty screens. Finish with a compact System overview and Architecture view from real health/metadata sources.

## 9. Phase plan and completion gate

Treat the migration steps above as separate phases. For each phase: inspect existing code; implement the backend/data/API contract; add unit and real-dependency integration tests; add the subsystem failure experiment; record measurements and limitations; update the relevant decision, documentation, and engineering journal; then expose only the completed capability in the UI. Run tests, lint, typecheck, build, and live data checks when the phase changes code. Stop after each phase for review before starting the next.

### First increment completed with this plan

The product direction is now part of `AGENTS.md`. The immediate live-data defect is corrected: the local web client and API CORS defaults use IPv4 loopback consistently while retaining the `localhost` origin for documented local access. The current UI remains otherwise unchanged until the first backend-backed workflow is ready.
