# AI Project Context Platform — Phase 0

Status: architecture proposal, 2026-11-03. This is the active product plan. Implementation phases restart at 0 for this brief; earlier phase numbers describe the previous conversation/laboratory direction.

Implementation update: Phase 1 runtime foundation is complete; see [setup, tests and failure evidence](../infrastructure/context-engine-foundation.md). The assessment below records the Phase 0 baseline, not the current absence of FastAPI.

Phase 2 update: the local TypeScript CLI and shared Python scanner are implemented. See [commands, discovery evidence, security limits and failure tests](../context/project-scanner.md). Scanner/analyzer HTTP APIs, shared storage and Atlas acceptance are not claimed.

Phase 3 update: Tree-sitter static analyzers now emit versioned, source-ranged facts for supported languages and local API/schema/document/dependency formats. See [coverage, evidence, limitations and failure tests](../context/analyzers.md). Unsupported/failed files produce partial status; no server ingestion, graph, storage, retrieval or Atlas acceptance was claimed for that phase.

Phase 4 update: scans produce a deterministic, project-scoped graph with bounded local exact-match and adjacency queries. See [graph schema, queries, provenance and limits](context-graph.md). Phase 4 itself did not persist or expose the graph.

Phase 5 update: a local operator can persist validated artifacts as checkpointed immutable PostgreSQL generations, roll back the head, or delete one confirmed environment. See [ADR-016](../decisions/ADR-016-atomic-context-graph-generations.md). Membership authorization and shared APIs remain future work.

Phase 6 update: the local scanner emits bounded, screened text chunks; PostgreSQL stores them with graph generations and the CLI searches graph facts/chunks with provenance. See [ADR-017](../decisions/ADR-017-local-graph-retrieval.md). This is not the completed retrieval phase: semantic/hybrid search, ACLs, runtime isolation evidence, and chat/Hermes integration remain open.

User direction update (2026-11-03): a local MLX chat now stores transcript turns in PostgreSQL using the existing owner-scoped conversation/message services; see [ADR-015](../decisions/ADR-015-local-chat-conversation-persistence.md). It uses one server-owned local development principal, not login/authentication, and remains restricted to the local prototype boundary. Hermes curated memory is separate; the browser chat does not write to Hermes memory. Chat remains ungrounded: no project retrieval, citations, tenant identity or external-app SDK is wired into the browser path. The chat route checks configured browser origin, loopback binding and non-production mode; these checks are not authentication, and another local process can call the API. Project answers and FDE integration remain gated on authorization-aware retrieval, context compilation, evaluation and real identity.

## Repository assessment

| Evidence | Current implementation | Treatment |
| --- | --- | --- |
| apps/api/src/app.module.ts | Configuration, health, conversation modules | Reuse control-plane foundation; conversation is outside V1 |
| apps/api/src/main.ts | Request IDs, Pino, body limits, rate limits, CORS | Reuse; add authenticated scopes and trace propagation |
| apps/api/src/database/ | pg pool, transaction helper, checksum/advisory-lock SQL runner | Retain raw pg and one migration authority |
| apps/api/migrations/0001 through 0005 | pgvector plus 20 conversation-oriented tables | Preserve applied history and data; add isolated product schema later |
| apps/api/src/redis/ | PING/readiness only | No queue/cache dependency justified for V1 foundation |
| apps/web/src/ | Authenticated local chat and `/system` diagnostics | Chat calls NestJS and the live configured inference provider; no project context yet |
| package.json | npm workspaces and lockfile | Keep npm; package-manager migration has no present benefit |

There is no durable context graph, shared project API, retrieval implementation, tenant authorization, or Atlas integration. The Phase 4 graph exists only in local scanner artifacts. Existing owner_user_id constraints do not establish organization tenancy or permission-aware context retrieval. Existing tables named embeddings/documents/context_snapshots do not fulfill the new project-context contracts.

## Product scope

V1 securely discovers and analyzes repository source, normalizes graph/provenance, indexes approved content, retrieves within a mandatory security scope, and compiles cited context. The local MLX CLI is an isolated raw-generation prototype and is not part of the project-context retrieval flow. A separately scoped, local-only Hermes stdio MCP adapter now exposes the Phase 4 scan and graph; it is not the authenticated Phase 10 `AgentContextProvider`, and it does not complete V1 retrieval. Business data, personal memory, persistent conversation integration, and autonomous execution remain outside this scope. Embedding models are context-computation components and remain distinct from generative inference.

Atlas Commerce is the first real acceptance target. Its checkout location and approved revision have not been supplied or verified. Phase 9 cannot be declared complete using a substitute sample repository.

## Overall architecture

~~~mermaid
flowchart TD
    App[Existing application] --> Client[Thin SDK or CLI]
    Client --> API[NestJS control plane]
    API --> Policy[Identity and access policy]
    API --> Engine[FastAPI context engine]
    Policy --> Control[(PostgreSQL control tables)]
    Engine --> Context[(PostgreSQL context tables and pgvector)]
    Local[Local scanner using shared Python analysis core] --> Artifact[Sanitized versioned artifact]
    Artifact --> API
    Engine -. later if justified .-> Redis[Optional Redis]
~~~

Two application runtimes, one database, HTTP communication. NestJS stays a modular monolith; FastAPI groups context computation in one service. No additional service or broker is introduced without workload evidence. Separate logical table ownership and database roles reduce accidental coupling; they do not eliminate trust in either service.

## Foundation choices

Keep Node/npm workspaces and raw pg. Propose uv for an independently locked Python environment under apps/context-engine with Python 3.12 as a conservative initial baseline, validated during Phase 1. Use a shared Python analysis library behind both the local CLI runner and FastAPI. The TypeScript CLI coordinates commands; it does not duplicate parser logic. Packages are added only when consumed: SDK, generated API types, and HTTP client.

Use separately version-locked Tree-sitter grammar wheels for Python/JS/TS/GraphQL/PostgreSQL/JSON/YAML in the shared Python analyzer core. Phase 3 validated syntax and NestJS/GraphQL patterns with fixtures and local source; see [ADR-010](../decisions/ADR-010-static-analyzer-toolkit.md). Syntax facts and framework decorator facts are explicitly labeled and are not runtime proof. Cross-file symbol resolution is a separate capability with confidence/provenance; do not claim a call graph from identifier-name matches alone.

## Migration and phase sequence

| Phase | Deliverable | Required acceptance |
| --- | --- | --- |
| 0 Architecture | This proposal, boundaries, model, contracts, ADRs and threat model | Review consistency; no runtime changes |
| 1 Foundation | FastAPI, Python lock, internal auth/timeout contract, correlation, Compose readiness, narrow Nest client | Engine outage produces bounded 503; PostgreSQL outage/recovery; no inference dependency |
| 2 Project scanner | context init and context scan; local shared core; exclusion/secret boundary | Deterministic real counts; invalid root, symlink escape, huge/binary files, secret fixtures, resource caps |
| 3 Analyzers | AST, REST/GraphQL/OpenAPI, schema, docs and dependency adapters | Source ranges validated; parser failure isolated; no repo code or config execution |
| 4 Context graph | Versioned in-memory graph artifact and graph queries | Stable IDs, scoped edges, source provenance; partial/unsupported facts explicit |
| 5 Storage | Additive schema, scoped runtime role, checkpointed immutable graph publication, rollback and confirmed environment deletion are implemented for local operator use. Authenticated project membership remains future work. | PostgreSQL migrations on existing and fresh databases, non-owner RLS scope, composite FK denial, concurrent/idempotent indexing, interrupted-batch resume, deletion and rollback verified locally; load and authenticated tenant isolation remain unverified |
| 6 Retrieval | Local CLI baseline stores screened chunks and searches graph names/attributes plus PostgreSQL full-text/literal chunk content in one published generation, returning provenance and bounded graph neighbors. Full phase remains incomplete: semantic/hybrid retrieval, membership/ACL filtering, service API and isolation evidence are absent. | Python syntax check only; no migration/query runtime experiment or automated tests; no embedding model selected; browser chat and Hermes remain unconnected |
| 7 Compiler | Cited deterministic sections and bounded token estimates | Budget overflow, malicious text, no unauthorized sources, tokenizer/source labels |
| 8 Evaluation | Versioned judged datasets and measured CLI reports | Recall@K, Precision@K, MRR, irrelevant rate and latency; explicit missing labels |
| 9 Atlas integration | Real Atlas scan/index/search and expected-source judgments | Named revision, reviewed source labels, measured results; no secret exposure |
| 10 Future agent integration | AgentContextProvider and Hermes tool adapter; replaceable runtime | Only after all V1 gates pass; no unrestricted DB access |

The local Hermes adapter is a development bridge over the current in-memory scanner/graph only. The Phase 10 production integration remains gated on storage, authorization-scoped retrieval, compilation, and evaluation; see [ADR-014](../decisions/ADR-014-hermes-local-mcp.md).

Phases 2–4 use sanitized local artifacts; durable graph indexing is added in Phase 5, preserving the requested order. A local scan may run without platform credentials because it never contacts shared storage. Shared project APIs require identity and authorization before their first release. The initial internal service identity is not a substitute for user authorization.

No existing migrations, conversation data, Redis volumes, or runtime modules are removed in Phase 0. New product tables are proposed under context_platform to avoid quietly reinterpreting legacy user-owned projects as tenant projects. Any later migration/import of legacy records requires an explicit mapping and review. Redis remains existing infrastructure but is not a required context service dependency.

## Decision register and open inputs

See [decision register](../decisions/README.md), [service boundaries](service-boundaries.md), [model](context-data-model.md), [API contract](context-api.md), and [threat model](../security/threat-model.md).

Before customer acceptance: locate Atlas checkout; agree on permitted repository scope and revision; select customer identity integration and same-project source access policy; choose an embedding model/license/dimension and tokenizer from measured evaluation; establish repository size and latency targets. These are explicit implementation gates, not invented deployment facts.

## Completion record

Phase 0 inspects source and produces design artifacts only. It does not claim current runtime health or newly passing runtime tests. Documentation link and diagram-coverage checks are recorded in the engineering journal.

