# Engineering Contract

## Mission

Build a private, production-minded AI infrastructure and memory platform as a learning system. The control surface is a means to inspect and operate the backend; it is not the product's architectural center. Teach through explicit boundaries, documented decisions, operational evidence, and honest limitations.

## Architecture principles

- Start as a modular monolith. Add a service, queue, cache, or abstraction only for a stated requirement and measurable benefit.
- Keep persistent memory, conversation history, retrieved context, and a model's bounded inference window distinct in code, storage, metrics, and documentation.
- Every inference is built from an explicit, inspectable context budget. Reserve output capacity and reject or compact input before it can exceed the selected model's supported limit.
- Place model and agent integrations behind application-owned interfaces. Provider-specific types and behavior stay in adapters.
- Keep persistence and external I/O behind module-owned interfaces. A module may depend on a narrower lower-level contract; it must not reach into another module's internals.
- Prefer PostgreSQL as the system of record. Treat Redis, queues, vector indexes, and caches as replaceable derived or operational state unless a documented decision says otherwise.
- Design retries, idempotency, cancellation, streaming disconnects, and partial failure explicitly. Do not assume distributed operations are atomic or exactly once.
- Make the inference node replaceable through configuration and provider contracts; do not bake a particular Mac, model, or address into application logic.
- Avoid premature microservices, Kubernetes, event sourcing, CQRS, Kafka, and service mesh. Record the concrete pressure that would justify a later change.

## Module boundaries and dependency rules

- Organize the API by capability (for example conversations, context, memory, retrieval, models, agents, tools, jobs, identity, and observability), not by framework primitive alone.
- Domain/application code must not import framework transport details, database clients, queue clients, or vendor SDKs directly.
- Controllers validate transport input, call application services, and map results. They do not own business policy or database query composition.
- Repositories own persistence queries and mapping. Transactions are explicit at application use-case boundaries and documented with their consistency requirements.
- Agent/model adapters translate between stable internal contracts and provider protocols. Do not leak provider response formats beyond the adapter.
- Cross-module communication uses exported application contracts. Avoid circular dependencies and shared mutable state.
- Shared packages contain stable, genuinely shared contracts or utilities; they are not a dumping ground for domain behavior.
- Tool execution is a privileged boundary: each tool has an explicit schema, authorization check, timeout, resource limit, and auditable result.

## Coding conventions

- TypeScript is strict. Avoid `any`; use `unknown` at untrusted boundaries and narrow it. Validate all external input at runtime.
- Prefer small cohesive modules, explicit return types at public boundaries, and dependency injection through narrow interfaces.
- Name units and semantics in APIs: token estimates versus provider-reported usage, timeout durations, ownership scopes, and nullable states must be clear.
- Comments explain why a constraint or decision exists, not what the next line does. Keep comments accurate as behavior changes.
- Configuration is validated once at startup, typed, and injected. Never commit secrets or log credentials, prompts, or private memory by default.
- Use UTC timestamps in persistence and structured logs. Preserve request/run correlation across API, queue, agent, and inference boundaries.
- Keep changes incremental. Do not generate the whole planned system at once; update docs and the engineering journal with each approved phase.

## Testing and verification strategy

- Use unit tests for deterministic domain policies (budgeting, ranking, authorization, retry classification) and service behavior.
- Use integration tests against real PostgreSQL/pgvector and Redis/BullMQ for persistence, transactions, indexes, queue semantics, and failure behavior; mocks alone cannot establish these guarantees.
- Use API end-to-end tests for critical authorized workflows and streaming/cancellation behavior. Add browser tests only for critical control-plane journeys.
- Include adversarial and boundary cases: over-budget context, malformed provider events, duplicate jobs, cancellation races, permission denial, and unavailable dependencies.
- For each phase, record exactly which checks ran, their results, and any environment-dependent checks not run. Never describe an unrun check as passing.
- Verification commands and tests are selected and executed as part of an explicitly approved implementation/verification phase; documentation-only work does not imply runtime verification.

## Security rules

- Treat browser input, retrieved documents/memories, model output, tool arguments, provider events, and queue payloads as untrusted.
- Enforce authentication and object-level authorization server-side on every protected operation. UI visibility is not authorization.
- Keep inference, database, Redis, and provider credentials on trusted server-side infrastructure. Expose only necessary endpoints through an authenticated private network.
- Apply input and body-size limits, rate limits, secure headers, strict CORS, parameterized SQL/ORM APIs, and safe error responses.
- Prevent SSRF with destination allowlists and network-level egress controls; URL parsing alone is insufficient.
- Apply least privilege to tools and runtime identities. Require explicit permission for side effects; log who initiated a tool and what resource it affected.
- Redact secrets and sensitive content from logs, metrics labels, traces, and error reports. Define retention and deletion behavior for conversations, memories, embeddings, and audit events.
- Document threat assumptions and residual risks before exposing the system beyond localhost or its private network.

## Observability rules

- Emit structured logs with request ID, trace/run ID, operation, dependency, outcome, and duration where applicable. Never use unbounded identifiers or private text as metric labels.
- Track inference phases separately: queue wait, prompt processing/TTFT, generation, total duration, token counts and their source, model/provider, timeout, and disconnect/cancel state.
- Measure database, Redis, queue, retrieval, and provider latency and failure rates. Health checks distinguish process liveness from dependency readiness.
- Carry correlation identifiers through asynchronous jobs and streaming events. Record enough lifecycle state to diagnose partial responses and retries.
- Keep estimates labeled as estimates and provider-reported values labeled as actuals. Dashboards must not imply stronger precision than the instrumentation supports.

## Local development strategy

- Keep local setup reproducible and documented. Validate configuration at startup and provide a safe example environment file without real secrets.
- Develop dependencies locally with Compose where practical; keep the inference runtime configurable and independently replaceable because Apple MLX is host-specific.
- Document ports, readiness order, migrations, data volumes, reset behavior, and which services are optional for an initial milestone.
- Keep private-network and production deployment guidance distinct from localhost defaults. Do not expose an inference server publicly for convenience.
- Establish only the minimum scaffold in Phase 0. Add frameworks, packages, infrastructure, and operational behavior incrementally in approved phases.

## Phase discipline and learning record

- Work one phase at a time. At its end, summarize artifacts, evidence, open limitations, architectural tradeoffs, and the next phase; wait for explicit approval before starting that next phase.
- For significant decisions, state problem, constraints, alternatives, decision, tradeoffs, failure modes, scaling, security, observability, and interview questions. Capture durable choices as ADRs.
- Maintain `docs/engineering-journal.md` with the initial expectation, observed behavior, implementation, failures and root causes, architectural lesson, and interview lesson for significant work. Do not invent incidents or claim experiments that did not occur.
