# Local Company AI and Project Context Platform

A local PDF assistant with account permissions, PostgreSQL/pgvector retrieval and MLX evidence selection. The same repository also contains a separate project scanner, static analyzer, graph store and local Hermes tools. These paths have different security and maturity boundaries.

## Read only what you need

| Document | Purpose |
| --- | --- |
| [Architecture](docs/architecture/system.md) | What exists, request/data ownership, permission model, API boundaries and remaining roadmap |
| [Local platform guide](docs/guides/local-platform-guide.md) | Install, run, upload, configure Google Workspace, inspect data and recover from failures |
| [Project-context operations](docs/context/storage-operations.md) | Scanner, analyzers, graph publication, lexical retrieval and the separate Hermes bridge |
| [Decision register](docs/decisions/README.md) | Why each major choice exists, its cost, alternatives and when to reconsider it |
| [Engineering and interview notes](docs/interview/README.md) | Problem → mechanism → drawback → when to use → implementation → interview follow-up |
| [Engineering journal](docs/engineering-journal.md) | Dated implementation evidence, failures and verification limitations |

These seven product documents replace overlapping topic files. `AGENTS.md` files remain engineering instructions. Keep future notes in the owning document instead of creating a file for every concept.

## Current capability and limits

| Capability | Honest status |
| --- | --- |
| PDF extraction and RAG | Implemented; text PDFs, local embeddings, authorized hybrid search and exact quoted citations |
| Vector database | Actual 384-dimensional embeddings in PostgreSQL/pgvector; exact search, no ANN index |
| Identity and RBAC | Local sessions and employee object permissions implemented; single organization per instance |
| Google Workspace | OIDC adapter/domain validation implemented; registered client configuration and live login acceptance still needed |
| Guardrails/privacy | Input/resource bounds, credential screening, access before retrieval, validated evidence IDs and metadata-only application logs; not comprehensive PII detection |
| Caching/routing | Scoped exact policy cache; semantic reuse implemented but off by default; configurable routing, no measured dual-model savings |
| Observability/evaluation | Real run metadata and synthetic evaluation fixtures; no full distributed tracing or company-corpus quality acceptance |
| Hermes | Separate local read-only project MCP bridge; not the browser assistant or an HR automation agent |

The admin uploads a PDF and classifies its access. Personal PDFs require one employee owner and salary/leave category. Their contents are snapshots: upload does not update payroll, calculate today's remaining leave, or approve a request. The model returns selected source quotations rather than unrestricted answer prose. An irrelevant quotation is still possible.

Start with the [local guide](docs/guides/local-platform-guide.md#start-the-local-system). No default organization/admin password is provided. Keep the pilot local and use synthetic data while evaluating it. Production access is disabled; production deployment, retention/erasure, MFA and company acceptance are unfinished.

## Evidence versus current runtime

The journal records the last implementation verification: 109 TypeScript tests and 48 Python tests passed; two other integration suites were skipped. Real local tests exercised PDF extraction, embeddings, pgvector, MLX, private-source denial and dependency recovery. These are dated observations, not a claim that services are running now or a throughput/security certification.

Generic project-context retrieval/compiler, Atlas Commerce acceptance and Hermes business tools remain separate open work. Follow the [phase gates](docs/architecture/system.md#project-context-roadmap); a working PDF assistant does not complete those milestones.
