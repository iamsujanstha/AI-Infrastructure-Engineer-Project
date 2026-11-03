# AI Project Context Platform — Phase 0

Status: architecture proposal, 2026-11-03. This is the active product plan. Implementation phases restart at 0 for this brief; earlier phase numbers describe the previous conversation/laboratory direction.

Implementation update: Phase 1 runtime foundation is complete; see [setup, tests and failure evidence](../infrastructure/context-engine-foundation.md). The assessment below records the Phase 0 baseline, not the current absence of FastAPI.

Phase 2 update: the local TypeScript CLI and shared Python scanner are implemented. See [commands, discovery evidence, security limits and failure tests](../context/project-scanner.md). Scanner/analyzer HTTP APIs, shared storage and Atlas acceptance are not claimed.

## Repository assessment

| Evidence | Current implementation | Treatment |
| --- | --- | --- |
| apps/api/src/app.module.ts | Configuration, health, conversation modules | Reuse control-plane foundation; conversation is outside V1 |
| apps/api/src/main.ts | Request IDs, Pino, body limits, rate limits, CORS | Reuse; add authenticated scopes and trace propagation |
| apps/api/src/database/ | pg pool, transaction helper, checksum/advisory-lock SQL runner | Retain raw pg and one migration authority |
| apps/api/migrations/0001 through 0005 | pgvector plus 20 conversation-oriented tables | Preserve applied history and data; add isolated product schema later |
| apps/api/src/redis/ | PING/readiness only | No queue/cache dependency justified for V1 foundation |
| apps/web/src/ | One health screen | Retain existing diagnostic surface; UI is later work |
| package.json | npm workspaces and lockfile | Keep npm; package-manager migration has no present benefit |

There is no FastAPI application, scanner, CLI, SDK, context graph, retrieval implementation, tenant authorization, or Atlas integration in the inspected checkout. Existing owner_user_id constraints do not establish organization tenancy or permission-aware context retrieval. Existing tables named embeddings/documents/context_snapshots do not fulfill the new project-context contracts.

## Product scope

V1 securely discovers and analyzes repository source, normalizes graph/provenance, indexes approved content, retrieves within a mandatory security scope, and compiles cited context without calling a generative model. Business data, personal memory, conversations, autonomous execution, Hermes, MLX, and Qwen are outside V1. Embedding models are V1 computation; they are distinct from future generative inference.

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

Use tree-sitter-based TS/JS syntax parsing in Python as the initial analyzer proposal. Syntax facts and framework decorator facts must be distinguished from inferred runtime calls. Cross-file symbol resolution is a separate capability with confidence/provenance; do not claim a call graph from identifier-name matches alone. Phase 3 evaluates parser coverage against real NestJS/GraphQL patterns before accepting the parser ADR.

## Migration and phase sequence

| Phase | Deliverable | Required acceptance |
| --- | --- | --- |
| 0 Architecture | This proposal, boundaries, model, contracts, ADRs and threat model | Review consistency; no runtime changes |
| 1 Foundation | FastAPI, Python lock, internal auth/timeout contract, correlation, Compose readiness, narrow Nest client | Engine outage produces bounded 503; PostgreSQL outage/recovery; no inference dependency |
| 2 Project scanner | context init and context scan; local shared core; exclusion/secret boundary | Deterministic real counts; invalid root, symlink escape, huge/binary files, secret fixtures, resource caps |
| 3 Analyzers | AST, REST/GraphQL/OpenAPI, schema, docs and dependency adapters | Source ranges validated; parser failure isolated; no repo code or config execution |
| 4 Context graph | Versioned in-memory graph artifact and graph queries | Stable IDs, scoped edges, source provenance; partial/unsupported facts explicit |
| 5 Storage | Additive context_platform migrations, scoped publication and checkpoints | Real PostgreSQL constraints/RLS, duplicate/concurrent indexing, crash/resume, deletion and rollback |
| 6 Retrieval | Structured, lexical, semantic, graph and hybrid search | Filter before candidates; cross-tenant/project/environment and same-project ACL denial; embedding failure explicit |
| 7 Compiler | Cited deterministic sections and bounded token estimates | Budget overflow, malicious text, no unauthorized sources, tokenizer/source labels |
| 8 Evaluation | Versioned judged datasets and measured CLI reports | Recall@K, Precision@K, MRR, irrelevant rate and latency; explicit missing labels |
| 9 Atlas integration | Real Atlas scan/index/search and expected-source judgments | Named revision, reviewed source labels, measured results; no secret exposure |
| 10 Future agent integration | AgentContextProvider and Hermes tool adapter; replaceable runtime | Only after all V1 gates pass; no unrestricted DB access |

Phases 2–4 use sanitized local artifacts; durable graph indexing is added in Phase 5, preserving the requested order. A local scan may run without platform credentials because it never contacts shared storage. Shared project APIs require identity and authorization before their first release. The initial internal service identity is not a substitute for user authorization.

No existing migrations, conversation data, Redis volumes, or runtime modules are removed in Phase 0. New product tables are proposed under context_platform to avoid quietly reinterpreting legacy user-owned projects as tenant projects. Any later migration/import of legacy records requires an explicit mapping and review. Redis remains existing infrastructure but is not a required context service dependency.

## Decision register and open inputs

See [decision register](../decisions/README.md), [service boundaries](service-boundaries.md), [model](context-data-model.md), [API contract](context-api.md), and [threat model](../security/threat-model.md).

Before customer acceptance: locate Atlas checkout; agree on permitted repository scope and revision; select customer identity integration and same-project source access policy; choose an embedding model/license/dimension and tokenizer from measured evaluation; establish repository size and latency targets. These are explicit implementation gates, not invented deployment facts.

## Completion record

Phase 0 inspects source and produces design artifacts only. It does not claim current runtime health or newly passing runtime tests. Documentation link and diagram-coverage checks are recorded in the engineering journal.

