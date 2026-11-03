# Context graph

A graph is a structured representation of repository facts with evidence, not an LLM-generated architecture claim. Nodes use the brief's project/application/module/file/class/function/service/repository/api/database_entity/document/dependency/business_rule types. Every node and relationship carries mandatory scope and generation.

~~~mermaid
flowchart LR
    Project[Project] -->|contains| Module[Checkout module]
    Module -->|contains| Service[CheckoutService]
    Service -->|depends_on| Repo[OrderRepository]
    Service -->|exposes| Operation[Checkout operation]
    Repo -->|stores| Entity[Order entity]
    Service -->|references| Source[Source version and line range]
~~~

This is a conceptual example, not a discovered Atlas result. Business-rule extraction must be evidence-backed and marked as inferred when appropriate. Decorator/import dependency does not prove a runtime call; unresolved/dynamic targets remain unresolved. Query by exact normalized identity, API signature, entity, dependency or bounded adjacency. Limit traversal depth, visited nodes and response size. Apply access labels to every node, edge and provenance source; an authorized endpoint node must not expose a hidden neighbor or its name.

