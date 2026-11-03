# Context graph

A graph is a structured representation of repository facts with evidence, not an LLM-generated architecture claim. Nodes use the brief's project/application/module/file/class/function/service/repository/api/database_entity/document/dependency/business_rule types. Every node and relationship carries mandatory scope and generation.

## Phase 4 local implementation

`context scan --output <artifact.json>` now includes a graph schema version 1 artifact. Graph construction is deterministic from the scanner artifact, uses UUIDv5 IDs derived from project scope and logical source/fact identity, and computes a generation ID from source hashes, analyzer/scanner versions and partial-coverage state. Node and edge IDs remain stable when unchanged facts move within their file; a changed scan produces a new generation ID.

The graph currently contains project, file, module, class, function, API, database-entity, document and dependency nodes. It models project/file containment, file declarations/imports/dependencies, and PostgreSQL table/column containment. Dynamic imports and static API operations remain unresolved statements backed only by syntax evidence. It does not infer service calls, cross-file symbol links, runtime reachability, business rules or ACLs. Every node and edge has project scope and generation; fact-backed nodes/edges carry relative path, content hash, analyzer version and exact inclusive source lines. The synthetic project root has no source provenance.

Every accepted source becomes a file node, including analyzer-failed and unsupported sources with their explicit status. Such files create no guessed semantic nodes. A graph is `partial` whenever the scan or analysis is partial. Coverage counts disclose analyzed, partial, failed and unsupported source counts.

The local graph query API is `graph.find_nodes` (exact type/name/path match) and `graph.traverse_graph` (bounded breadth-first adjacency). The CLI exposes these over a saved local scan artifact:

~~~sh
npm run context -- graph find --artifact .context-platform/scan.json --type api --name 'GET /users'
npm run context -- graph traverse --artifact .context-platform/scan.json --node-id <node-uuid> --depth 2 --limit 100
~~~

Find requires an exact selector. Traversal is capped at depth 4 and 200 returned nodes; artifacts are bounded to 64 MiB, opened without following a final symlink, and decoded as JSON data only. The local CLI is not an authorization boundary: do not expose graph query routes until tenant/user authorization and access filtering are implemented. No graph is persisted or published in this phase.

~~~mermaid
flowchart LR
    Project[Project] -->|contains| Module[Checkout module]
    Module -->|contains| Service[CheckoutService]
    Service -->|depends_on| Repo[OrderRepository]
    Service -->|exposes| Operation[Checkout operation]
    Repo -->|stores| Entity[Order entity]
    Service -->|references| Source[Source version and line range]
~~~

This is a conceptual example, not a discovered Atlas result. Business-rule extraction must be evidence-backed and marked as inferred when appropriate. Decorator/import dependency does not prove a runtime call; unresolved/dynamic targets remain unresolved. Query by exact normalized identity, API signature, entity, dependency or bounded adjacency. Limit traversal depth, visited nodes and response size. Before server exposure, apply access labels to every node, edge and provenance source; an authorized endpoint node must not expose a hidden neighbor or its name.

