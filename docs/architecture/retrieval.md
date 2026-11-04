# Retrieval and context compilation

## Current implementation status

The local CLI has a read-only lexical/structural search path over the current published PostgreSQL generation; see [ADR-017](../decisions/ADR-017-local-graph-retrieval.md) and the [storage operations guide](../context/storage-operations.md). It searches node names and JSON attributes, full-text/literal chunk content, returns provenance, and expands bounded same-generation graph neighbors. Semantic embeddings, hybrid fusion, shared API, source ACLs, and the deterministic context compiler are not implemented. Phase 6 is incomplete and Phase 7 has not started. Do not describe browser chat or Hermes as using this retrieval path.

~~~mermaid
flowchart TD
    Request[Query with authorized scope and pinned generation] --> Filter[Restrict project environment and access labels]
    Filter --> Structured[Structured exact lookup]
    Filter --> Lexical[PostgreSQL full text]
    Filter --> Semantic[pgvector model-specific search]
    Filter --> Graph[Bounded graph traversal]
    Structured --> Rank[Normalize deduplicate and rank]
    Lexical --> Rank
    Semantic --> Rank
    Graph --> Rank
    Rank --> Select[Select under token budget]
    Select --> Compile[Cited context package]
~~~

Unauthorized rows must be excluded before any candidate selection, graph expansion or ranking. Also validate all returned provenance; post-filtering alone leaks counts/ranking and can starve authorized results. Use a read-only transaction with tenant/project/environment scope and a pinned published generation. Source ACLs are part of candidate SQL, including lexical/vector queries, graph edges and source expansions.

Start with exact lookup and lexical baselines; semantic and graph additions must demonstrate measured quality. Rank fusion is a proposed baseline (such as reciprocal-rank fusion), not a fabricated probability. Return channel ranks, score kind/version and evidence for selection. If semantic search is unavailable, either fail clearly or use a caller-approved lexical-only mode and label it; never invent semantic scores.

Compilation emits project/generation, deterministic sections, selected nodes/relationships, versioned sources, token estimate with tokenizer/estimator identifier, included/excluded reasons and untrusted-content labels. It never calls the LLM. Summary means a deterministic factual outline in V1; generative summarization is out of scope. The budget covers headers/citations/sections as well as source text; output model reserve is relevant only when a caller supplies a future target model contract. If counting is approximate, label the estimate and apply a safety margin; don't claim exact hard model-token safety. Reject a budget that cannot fit required metadata. Revalidate authorization before response and handle revocation with bounded permit expiry.

Future application-owned contract: AgentContextProvider.search(ContextSearchRequest) and .compile(ContextCompileRequest). Both require authenticated scope; the SDK injects transport credentials and project selection but cannot grant permissions.

~~~mermaid
flowchart LR
    Hermes[Future Hermes tool] --> Nest[NestJS authorization]
    Nest --> Engine[Context search and compile]
    Engine --> Context[Scoped cited untrusted context]
    Context --> Hermes
    Hermes --> Runtime[Replaceable future MLX or other runtime]
~~~

~~~mermaid
flowchart LR
    Agent[Future agent] --> Tool[Application-owned get_order tool]
    Tool --> Auth[Application authorization]
    Auth --> API[Scoped application API]
    API --> Data[Approved business fields]
~~~

Future business-data tools remain application-owned; no arbitrary SQL executor or unrestricted database credential is provided. These two diagrams describe future contracts only.

