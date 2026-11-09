# Decision register

This single register preserves ADR identities while replacing one-file-per-decision duplication. It owns **why**, alternatives, costs and reconsideration conditions; [architecture](../architecture/system.md) owns current contracts, the [local guide](../guides/local-platform-guide.md) owns procedures, and the [journal](../engineering-journal.md) owns dated evidence. An accepted local choice is not production certification.

Consolidated 2026-11-09. Original ADR numbers are retained; there was no ADR-004 file. Historical scope changes are explicit below rather than left as contradictory “current” architecture pages. Documentation cleanup did not execute application checks or change these decisions' runtime behavior.

## Decision discipline

Before adding infrastructure, identify the actual failed behavior and simplest working alternative. Specify the authority/security boundary, partial failure/recovery, observability and measured pressure for reconsideration. Do not add a service, queue, cache, vector/graph database or autonomous tool merely to broaden the stack.

| Choice to reconsider | Evidence that would justify the added complexity |
| --- | --- |
| Separate vector store / ANN | Authorized exact-search latency/index memory exceeds a measured target and quality remains acceptable under permission filters |
| Queue / worker service | Noninteractive work needs durable resume, measured contention or independent isolation; job identity/revocation/retry semantics are designed |
| Redis cache | Measured reuse/coordination beyond the existing PostgreSQL cache; extra dependency cost is justified |
| Policy engine / microservices | Concrete policy complexity, independent team ownership or scaling/failure isolation pressure |
| Reranker / fine-tuning | Judged stage-specific quality gap persists after source/extraction/retrieval improvements |
| Autonomous agent | A bounded workflow actually needs model-directed choices, not just a known database lookup |

<a id="adr-001"></a>
## ADR-001: PostgreSQL as system of record

**Accepted, 2026-11-02; still active.** Users, documents, owners, payroll and leave need relational constraints and multi-row transactions. PostgreSQL also hosts initial vector search, reducing copies and synchronization boundaries. SQLite is attractive for a truly embedded single-process app, but does not exercise the intended server concurrency/pgvector topology. MongoDB or a separate vector store would still require ownership and cross-store consistency design.

The cost is schema/query/backup operations and shared contention. A successful `SELECT 1` proves connectivity, not restore readiness or capacity. Keep replica pools within a global connection budget; consider query/index work and pooling before replicas. Reconsider a separate store only for measured workload or operational-isolation pressure.

**Question to defend:** what breaks if the vector index becomes the only record of an employee's authoritative salary? Derived search state cannot replace audited transactional source records.

<a id="adr-002"></a>
## ADR-002: Redis remains optional operational infrastructure

**Historical accepted foundation, 2026-11-02; dependency narrowed by later scope.** Redis has a lazy client/readiness probe and optional Compose service. The PDF workflow uses neither a Redis queue nor Redis answer cache. PostgreSQL remains authoritative; Redis AOF is not a complete backup/durability guarantee.

Adding BullMQ now would add workers, retry/duplicate semantics, eviction/availability decisions and monitoring without a demonstrated need. PostgreSQL-backed jobs may also be simpler if transactional dispatch matters. When durable asynchronous work is justified, design idempotency, limits, cancellation, dead-letter/reconciliation and privacy first; a broker does not provide exactly-once business effects.

**Question:** what does `PING` establish about queue delivery? Only Redis connectivity, not job execution or correctness.

<a id="adr-003"></a>
## ADR-003: Raw pg and one migration authority

**Accepted, 2026-11-02; implemented.** Parameterized SQL, explicit transactions and owned repositories keep PostgreSQL/pgvector behavior reviewable. The existing runner sorts SQL, acquires an advisory lock, verifies checksums and commits each migration with its ledger row. It rejects changed/missing applied files rather than silently repairing history.

An ORM can reduce repetitive mapping and improve generated contracts; raw SQL instead makes us responsible for row typing, parameterization, schema drift and query review. Values are parameters; dynamic identifiers require application-owned allowlists. All transaction statements must share one checked-out connection, released in `finally`.

Current transactional runner mode cannot run nontransactional DDL such as `CREATE INDEX CONCURRENTLY` without an explicit extension. Do not introduce a second migration ledger to avoid that constraint. Reconsider mapping abstractions when measured maintenance/errors justify them, while preserving one schema authority.

**Question:** how can a statement escape its transaction if one helper accidentally uses `pool.query`?

<a id="adr-005"></a>
## ADR-005: pgvector before a separate vector database

**Accepted, 2026-11-02; actual PDF vectors implemented later.** Keep metadata, permission predicates and embeddings in PostgreSQL. Current company PDFs use 384-dimensional local BGE embeddings and exact authorized search. The separate project-code semantic path remains incomplete; enabling the extension alone did not establish that feature.

Cosine distance is a relevance signal, not truth or access control. Exact search costs a scan of eligible rows but gives an inspectable comparison baseline. ANN trades recall/index operations for speed; add it only after representative measurements, including selective ACL cases. Separate vector storage is justified only when it solves a measured pressure worth synchronization/deletion complexity. Vectors inherit source sensitivity.

**Question:** why does global ANN top-K followed by an application permission filter have both security and recall problems?

<a id="adr-006"></a>
## ADR-006: Nest owns control and business policy

**2026-11-03 proposal; implemented for CMS, still incomplete for shared project APIs.** Identity, roles, object permissions, audit and orchestration remain in Nest. Python receives a validated service request and scope rather than independently deciding employee privileges. This avoids conflicting permission policy and a confused deputy trusting browser-supplied organization/role fields.

One policy owner costs a typed internal protocol and dependency deadlines. The current PDF bearer/HMAC binds exact request bytes, actor/organization/operation and freshness; it is not the full proposed project permit, key-rotation system or a single-use capability. Shared project operations still require real membership/environment/source-label gates before exposure.

**Question:** if the internal service credential is stolen, which guarantees remain and which trust boundary is breached?

<a id="adr-007"></a>
## ADR-007: Python computation with a reusable core

**2026-11-03 proposal; runtime/shared core implemented.** FastAPI wraps Python extraction/embedding work; CLI and HTTP reuse analysis functions instead of implementing separate analyzers in Node. Locked Python/grammar/model artifacts improve reproducibility.

The alternative all-Node implementation reduces runtime operations but does not fit the selected computation ecosystem as directly. A separate service for every parser/model would multiply deadlines/credentials before measured need. Python brings native-code/parser risks and CPU/memory limits: PDF extraction has Linux limits; the project analyzer worker still lacks its own OS memory quota. They are different guarantees.

**Question:** what do you lose by allowing a dependency to download missing grammar/model artifacts during an ordinary private request?

<a id="adr-008"></a>
## ADR-008: Separate project schema and scoped generations

**2026-11-03; storage implemented locally by ADR-016.** Preserve legacy user-owned/conversation tables and add `context_platform` rather than redefining their semantics with nullable tenant fields. Every environment-owned graph row/edge carries composite scope and generation. Restricted-role RLS and explicit predicates constrain mistakes; operator-provided UUIDs are not authenticated membership.

A single JSON blob is simpler but weakens selective queries/constraints. Separate graph/vector stores create synchronization burdens. Scoped relational rows cost storage, indexes and schema discipline. The exact historical `0006` checksum alias plus `0007` reconciliation remains narrow; it does not waive migration integrity.

**Question:** why must an edge's endpoint foreign keys include generation and full scope rather than only node UUID?

<a id="adr-009"></a>
## ADR-009: Context-first project scope and phase gates

**Original direction, 2026-11-03; later explicit local assistant amendment.** Reusable project V1 targets discovery → analysis → graph → storage → retrieval → compiler → evaluation → approved Atlas integration, then shared agent integration. This isolates evidence quality from fluent model answers and prevents a synthetic demo from standing in for customer acceptance.

The user later authorized local MLX, manual evidence mode and the CMS/PDF increment. Those are real separate capabilities, not completion of the original project compiler/Atlas gates. Do not resume the superseded laboratory roadmap or add broad business agents implicitly. Keep phase review and unresolved customer inputs explicit.

**Question:** how would you evaluate project retrieval without a generative model hiding its misses?

<a id="adr-010"></a>
## ADR-010: Version-locked static analyzers

**Accepted for local analysis, 2026-11-03.** Parse screened source with local Tree-sitter grammar wheels and safe JSON/YAML/TOML readers; never run the inspected repository's imports/builds/configuration. Regex-only declarations misread comments/nesting, while runtime execution violates the untrusted-source boundary.

A recorded native parser crash motivated pinned core compatibility and spawned/recycled per-file workers. This costs native dependency maintenance and explicit partial-language coverage. Static declarations do not prove dynamic paths, runtime calls, ORM state or deployed authorization. Bound fact output/time; isolate memory/admission before shared ingestion.

**Question:** what evidence is missing between finding `@Get(':id')` and asserting the endpoint is reachable and authorized?

<a id="adr-011"></a>
## ADR-011: Deterministic graph identities and provenance

**Accepted for local artifacts, 2026-11-03.** Stable project/logical IDs connect declarations and explicit structural relations. Generation identity changes with content/configuration/coverage; source hashes/ranges identify evidence. Bounded lookup/traversal is sufficient before graph-database workload evidence exists.

Line numbers alone are unstable IDs, while matching names alone invents semantic edges. Duplicate occurrence ordinals and renames retain limitations. Artifact loading validates size/type/scope/provenance but consumes memory proportional to graph size. Shared APIs need source-label authorization on nodes, edges and provenance, not merely an authorized starting node.

**Question:** why should a node survive a line shift while its provenance range and generation change?

<a id="adr-012"></a>
## ADR-012: Replaceable local MLX adapter

**Accepted local prototype, 2026-11-03.** Keep Apple Metal inference in a host process behind the application provider contract. Nest does not import MLX or assume every OpenAI-shaped endpoint has identical capabilities. Bound destinations, redirects, output and deadlines; list actual available models.

The cost is provider availability, memory/throughput contention and adapter compatibility work. Non-streaming completion provides neither visible TTFT nor proven cancellation. Qwen3-specific thinking control stays in the adapter, with a configurable override and task-quality tradeoff. Recorded latency observations are individual runs, not hardware capacity claims. Keep the listener trusted/local; containers need a deliberately reviewed gateway boundary.

**Question:** why can increasing request timeout make overload worse without increasing throughput?

<a id="adr-013"></a>
## ADR-013: Legacy local browser boundary is not identity

**Accepted local convenience, 2026-11-03; disabled by default for CMS.** The earlier fixed-owner chat removed a manual token prompt and used exact Origin, non-production and loopback checks. That met a single-operator convenience requirement, not company authentication. Local callers can forge Origin; shared-network peers can reach container listeners despite loopback host publishing.

Reusing that owner for employees would expose unrelated historical chats. `LEGACY_LOCAL_CHAT_ENABLED=false` now keeps this surface off; records remain stored. Use CMS sessions/ownership instead. Re-enabling the flag is a development experiment, not a deployment shortcut.

**Question:** what does CORS protect, and why can `curl` with an Origin header not be considered an authenticated employee?

<a id="adr-014"></a>
## ADR-014: Local Hermes stdio bridge

**Accepted local read-only integration, 2026-11-03; not shared agent completion.** One fixed operator root and three bounded overview/literal-search/symbol tools expose narrower capability than a shell or unrestricted database. No new listener is needed.

The tradeoff is process-local scans, literal misses, duplicate work across Hermes processes, no CMS account policy and freshness/provenance limitations. Source inspection still shows cached hashes paired with reread text as a possible mismatch; use fixed checkout/reload and address it before claiming live coherent citations. See [Hermes operations](../context/storage-operations.md#hermes).

An authenticated context provider is the shared-production direction, requiring membership/source scope, compiler/evaluation and controlled tools. Embedding Hermes in every PDF request adds an agent/memory/tool lifecycle without demonstrated value.

**Question:** when is a deterministic retrieve-and-quote workflow preferable to an autonomous agent loop?

<a id="adr-015"></a>
## ADR-015: Preserve legacy transcripts separately from memory

**Accepted local persistence, 2026-11-03; HTTP surface now disabled by default.** Ordered conversation/messages/parts preserve refreshable transcript history and pending/succeeded/failed turn state. They are not Hermes curated memory, learned model weights or an unlimited inference window.

Persisting user/pending assistant before inference retains failure evidence; generated output then needs a separate completion write. If that write fails after inference, text may be lost or a row remain pending/streaming; reconciliation is not implemented. The server-owned principal is not CMS account identity. Storage/retention costs remain even with the UI disabled.

**Question:** why is inference completion not atomic with committing its message, and what would reconciliation inspect?

<a id="adr-016"></a>
## ADR-016: Immutable project publication with resumable checkpoints

**Implemented locally, 2026-11-04.** Indexing holds a scoped **session** advisory lock across 500-row batch transactions; each payload/checkpoint commits while unpublished. The final validated transaction marks published and switches one head. Readers pin that generation. Earlier committed batches are not rolled back when a later batch fails; only their visibility remains unpublished.

This solves interrupted indexing without one giant transaction or half-visible graphs. A canonical manifest deduplicates retries; row-count/checkpoint hashes validate resume. Rollback moves the head, not erasure. The cost is staging storage, WAL/checkpoints, lock wait and future retention/garbage collection. A session lock fails contenders after a bounded wait; distributed workers that outlive that session would need a lease/fencing design.

Local fresh/existing migrations, interruption/resume, concurrency/idempotency, FK/RLS checks, rollback and deletion were recorded; load and authenticated membership were not. [Operations](../context/storage-operations.md#storage) retain the safe commands.

**Question:** why are atomic publication and atomic execution of every batch different guarantees?

<a id="adr-017"></a>
## ADR-017: Honest local project retrieval baseline

**Implemented source, 2026-11-04; full phase/runtime acceptance incomplete.** Search pinned published graph names/attributes and screened chunks using full-text/literal matching with bounded same-generation neighbors. Use repeatable read, restricted role and explicit scope. Rank/match type is not probability; semantic search is explicitly unavailable for this path.

It makes persisted facts queryable without selecting an embedding model prematurely, at the cost of private source storage, JSON/substring scans and unmeasured relevance. The original change recorded syntax checks rather than PostgreSQL retrieval experiments/automated coverage. Later migration application is not full query/isolation verification. PDF RAG evidence does not transfer to this path.

Add project embeddings/ACL-aware indexed search after baseline runtime checks and held-out judgments, not to inflate the technology list.

**Question:** how do you distinguish no published generation, no lexical match, partial coverage and dependency failure without leaking denied sources?

<a id="adr-018"></a>
## ADR-018: Shared Docker development network

**Configuration added 2026-11-04; context-engine image/runtime verified in later PDF work.** App containers join an explicitly named external network and reuse service DNS; local database/Redis/pgAdmin remain opt-in. Browser-visible URLs differ from internal container addresses. MLX stays on the Mac with a deliberate development gateway exception.

This avoids duplicate infrastructure but enlarges peer reachability and makes DNS aliases/secret configuration important. Host loopback port publishing does not hide the API from network peers. An absent external network or wrong alias is a configuration error, not proof the app process died. Prefer host API mode when inference cannot be safely exposed to Docker.

The original Docker note recorded a daemon-access block. Later Linux context-engine build/start/offline embedding succeeded; do not infer every Node image and all shared-network flows were rerun. Separate private app networks are a later least-privilege deployment choice.

**Question:** why can localhost work in a browser but fail as a database address inside a container?

<a id="adr-019"></a>
## ADR-019: Evidence selection instead of arbitrary generated prose

**Implemented request-only experiment, 2026-11-09; legacy endpoint now disabled by default.** A prompt-only “use my context” rule cannot enforce absence of invented prose. Have the model select known passage IDs; the server returns exact originals or fixed not-found, rejecting invalid shape/IDs. This boundary is reused inside authenticated PDF RAG without re-enabling the legacy endpoint.

The benefit is inspectable source-only output; the cost is less fluent responses, wrong/incomplete selections and potential quotation of malicious or false evidence. A citation is not entailment or applicability. The manual experiment did not save history or attach tools/repositories. Do not add a summarizer/agent merely to make it sound smarter; that changes the guarantee and needs new evaluation.

**Question:** why can an answer with a valid citation still be wrong, and which narrower property do exact server quotations enforce?

<a id="adr-020"></a>
## ADR-020: Local CMS sessions and employee object policy

**Implemented local increment, 2026-11-09.** One local organization, four approved roles, opaque hashed eight-hour sessions, salted scrypt passwords and current account checks replace fixed-owner convenience. Explicit role/employee policy and transactional leave/payroll records let users see themselves, HR see all, accountants manage payroll/own leave, and admins manage accounts/documents. See the [matrix and residual risks](../architecture/system.md#authorization).

Server sessions favor direct revocation over self-contained role tokens; the cost is a DB dependency/read per protected request. Long answers recheck identity/revision/session, but delivered bytes cannot be revoked. Row locks protect leave reservations/decisions; dates are calendar days, not a full HR policy engine.

CMS non-owner RLS, production HTTPS/MFA/recovery and automated retention remain missing. PDF numbers do not automatically create financial records. Generalize policies or multi-organization membership only for actual customer requirements and tests.

**Question:** how do two four-day requests race against five remaining days, and why is UI button visibility irrelevant to that invariant?

<a id="adr-021"></a>
## ADR-021: PDF-first authorized local evidence

**Implemented/exercised locally, 2026-11-09; organization acceptance incomplete.** Migrations `0010`/`0011` add page vectors, scoped cache/run metadata, OIDC and per-employee PDF ownership. Admins provide PDF content and deliberate classification; names inside a file cannot grant access. Local CPU BGE embeddings plus authorized exact-vector/lexical fusion retrieve evidence for MLX ID selection. Original PDF bytes are not retained; extracted text/vectors remain sensitive.

A Linux-limited worker was chosen after native Mac memory caps failed. Busy/error responses are preferable to unbounded work or cloud fallback. Atomic document publication and revision checks protect freshness; identical active inputs deduplicate publication, while changed inputs need explicit old-version archival. Snapshot PDFs cannot establish live entitlement or salary state.

Exact policy cache is enabled and reauthorizes sources. Semantic reuse remains opt-in; token/negation fingerprint plus near-identical vector is conservative, not proof of equivalent questions. Personal selections are not cached. Model routing is allowlisted/configurable, not a measured cost-saving claim. Run metadata measures actual local work, not exported complete traces or actual token usage.

Google Workspace uses code/PKCE/state/nonce and validated signed claims, exact account bindings and required hosted-domain match. The registered client/live login still need configuration/acceptance. Real synthetic PDF/BGE/pgvector/MLX tests and a bounded compute outage/recovery were recorded; the tiny embedding fixture does not establish company quality. English/layout/owner targeting/privacy deployment limits are explicit in the guides.

**Reconsider:** add OCR, target-specific personal retrieval, applicability review, quality gates or bounded background jobs for observed customer failures. Do not add a second vector store, agent loop or production-looking dashboard to conceal those gaps.

**Question:** what changes when an allowed source is archived while a model request is running, and what remains uncertain after the final permission check?
