# ADR-011: deterministic local context graph

- **Status:** Accepted for Phase 4 local graph artifacts, 2026-11-03
- **Context:** Phase 3 emits source-ranged facts, but callers need stable identities and bounded relationships to inspect repository structure. The active roadmap defers durable indexing to Phase 5 and requires source provenance, scoped edges, and explicit partial coverage.
- **Constraints:** Keep the graph local/in-memory; do not add database tables, migrations, APIs, queues, or authorization claims. IDs must be stable within project scope. Every fact-derived node and edge must cite the exact screened source hash and inclusive source range. Traversal and artifact loading must be bounded.

## Decision

Build a versioned graph artifact as part of each local scan. Use UUIDv5 node and edge IDs based on project scope and logical identities, and a separate generation UUID based on source hashes, scanner/analyzer versions, scan status and coverage. Every node and edge includes the project scope and generation ID. Fact-backed entities include relative path, SHA-256, analyzer version and line range. Include a file node for each accepted source, with analyzed/partial/failed/unsupported status.

Support project/file containment, file declaration/import/dependency edges, and PostgreSQL table/column containment. Provide exact type/name/path lookup and bounded breadth-first traversal through Python functions and `context graph find|traverse` CLI commands over saved local artifacts. Keep graph creation/query logic in the context engine; the TypeScript CLI remains a thin process boundary.

## Alternatives

- **Persist directly to PostgreSQL:** deferred to Phase 5, which must define tenant/environment constraints, immutable publication and rollback first.
- **Infer cross-file calls or runtime services now:** rejected because imports, decorators and names do not establish runtime binding or reachability.
- **Use line numbers as node identity:** rejected because ordinary edits shift all following ranges. IDs use source/symbol identity; provenance line ranges remain generation-specific evidence.
- **Expose graph routes in FastAPI/NestJS now:** rejected because shared identity, object authorization and filtering are not implemented.
- **Use a graph database:** rejected without a measured query/workload need; adjacency in a bounded artifact is sufficient for local Phase 4 workflows.

## Consequences and tradeoffs

IDs remain stable across content-only line shifts for unambiguous logical facts, while generation IDs change with scanned source or coverage. Same-name duplicates in a file use a deterministic occurrence ordinal, so adding an earlier duplicate may change later IDs. Unsupported/failed files remain visible as source nodes but do not receive guessed semantic nodes. Static API declarations and imports are syntax evidence, not runtime edges. Query results are capped at depth 4 and 200 nodes; scan artifacts are capped at 64 MiB when loaded for query.

The graph artifact duplicates some source/fact metadata and costs memory proportional to accepted sources and facts. It is generated in-process after bounded scanning; no large-repository benchmark has been run. Before shared-service use, add authenticated project scope, tenant/environment scope, access labels, memory isolation and generation publication. Never expose current local graph functions as an unauthenticated API.

## Failure, security and observability

Graph construction rejects missing source references, content-hash mismatches, invalid line ranges and malformed project scope. Queries reject mismatched node/edge scopes or generations, unknown IDs, missing selectors, invalid limits and excessive depth. Unsupported analyzer inputs keep a partial graph status and explicit coverage. Artifact loading follows no final symlink, accepts regular files only, checks for concurrent modification and imposes a byte cap. Graph names, relative paths, import strings and routes can be sensitive; the artifact is local operator-controlled output and remains protected by mode 0600 when written through the existing CLI.

## Learning record

- **Problem:** Turn facts into navigable structure without inventing semantic relationships.
- **Internal behavior:** Deterministic identities and generation hashing bind project/file/domain nodes to source provenance; bounded exact lookup and BFS return only the artifact's project and generation.
- **Failure/recovery:** Corrupt provenance is rejected; unsupported/failed files remain explicit and the graph is partial. Re-scan after fixing source or parser input.
- **Scale pressure:** Graph materialization and adjacency indexing consume memory; durable publication and incremental updates belong to Phase 5 after corpus measurements.
- **Interview question:** Why should node IDs survive source-line shifts while source references and graph generation still change?
