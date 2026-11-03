# Service boundaries

Status: proposed contracts for V1.

Phase 1 implementation: service-token authentication, request/trace propagation, bounded health calls and safe outage/deadline responses are implemented; see [foundation verification](../infrastructure/context-engine-foundation.md). Health contains no project data and needs no project permit. The signed scope contract below remains mandatory before any shared project operation is exposed; no such routes exist in Phase 1. Health-token rotation is currently a coordinated reload, with no automatic key ring.

| Responsibility | Owner | Allowed dependencies |
| --- | --- | --- |
| Authentication, tenant membership, roles, project/environment authorization | NestJS | Control repositories and identity adapter |
| Public API, SDK integration, audit and indexing orchestration | NestJS | ContextEngineClient with bounded HTTP calls |
| Scanning, AST/API/schema/doc analysis, graph, chunking, embeddings, retrieval, reranking, compilation, evaluation | FastAPI/shared Python core | Scoped context repositories and configured model artifacts |
| Migration ledger and SQL DDL | Existing release migration command | Separate migration database role |
| CLI/SDK | Thin TypeScript integration | Public API; CLI local scanner subprocess for local commands |

Python validates service credentials and the signed authorization envelope; it does not decide tenant membership, business roles, or permission grants. It must enforce the already authorized scope in queries. A shared secret between services alone is insufficient: trusting arbitrary projectId fields would create a confused-deputy path.

~~~mermaid
sequenceDiagram
    participant Client
    participant Nest
    participant Policy
    participant Engine as FastAPI
    participant DB as PostgreSQL
    Client->>Nest: bearer credential and project path
    Nest->>Policy: authenticate and authorize operation
    Policy-->>Nest: authorized project/environment/source labels
    Nest->>Engine: service credential, signed short-lived scope, request/trace IDs, deadline
    Engine->>Engine: verify signature/audience/expiry and request schema
    Engine->>DB: transaction-scoped tenant/project and allowed-label filters
    DB-->>Engine: authorized candidates only
    Engine-->>Nest: typed result and provenance
    Nest-->>Client: validated response and request ID
~~~

Scope binds tenant, user, project, environment, allowed source labels, operation, policy version, request digest, audience and expiry. Roles/permissions come from Nest's verified principal, never a caller body. Key rotation and replay rules are part of Phase 1 internal-auth implementation. Indexing uses a persisted idempotency key and manifest digest rather than assuming HTTP retries are unique.

Nest and Python use distinct non-owner runtime database roles. Nest writes control/audit/orchestration tables; Python writes analysis/index/query artifacts. Migration credentials are never runtime credentials. Runtime roles cannot bypass RLS or alter scope policy. Auth refresh/revocation is checked at every public request; a short-lived internal permit bounds the remaining in-flight window. Publication rechecks a scan's authorized target and freshness.

Proposed budgets: connect within 1 second, search/compile total within 10 seconds, control/status within 3 seconds. Persist indexing intent and return 202; never hold an HTTP connection open for an entire large scan. Phase 1 validates configurable budgets and cancellation; final SLOs require workload measurement. Retry only idempotent reads within the original deadline; indexing retries require the same key/digest. Invalid/malformed engine responses are classified upstream errors. Unavailable engine returns safe 503, deadline expiry 504, caller errors 4xx. Never silently broaden retrieval or pretend semantic retrieval succeeded during an embedding outage.

