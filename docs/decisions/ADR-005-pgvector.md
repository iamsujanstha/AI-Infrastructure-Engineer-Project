# ADR-005: pgvector for Initial Semantic Retrieval

- **Status:** Accepted for the initial retrieval milestone
- **Date:** 2026-11-02

## Context

The platform needs semantic retrieval over project knowledge and memory while keeping ownership metadata and durable records close to the relational system. At Phase 1 there is no embedding model, vector column, retrieval query, or quality corpus.

## Decision

Use the PostgreSQL `vector` extension as the initial vector storage and similarity-query option. The Phase 1 migration enables the extension in the pgvector PostgreSQL 17 image. Phase 2/7 will choose embedding dimensions, distance metric, index type, metadata filters, and a relevance evaluation set before creating vector columns or indexes.

## Alternatives considered

- **Separate vector database:** Can scale vector search independently, but adds durable state and synchronization failure modes. Revisit if measured workload or index constraints exceed PostgreSQL's practical envelope.
- **Keyword-only PostgreSQL search:** Useful for exact terms and will complement semantic search, but does not alone retrieve paraphrases and conceptual matches.
- **No retrieval:** Simplest foundation, but fails the product's core objective of selecting relevant knowledge from a growing corpus.

## Consequences and tradeoffs

- Relational filters and semantic candidates can initially share a database and ownership boundary.
- Vector similarity is a candidate-generation signal, not proof of relevance. Hybrid ranking and measured retrieval quality are still required.
- Vector index choice trades recall, latency, and memory; no index is created before representative data and query patterns exist.
- Extension availability is now a migration prerequisite. A database image without pgvector will fail the migration and must not be marked ready for the retrieval phase.
- Vector operators use PostgreSQL SQL directly. Encapsulate these queries behind a repository boundary and parameterize all user-provided values.

## Security and observability

Embedding vectors can reveal sensitive semantic information and inherit the source record's access scope. Retrieval must filter by tenant/user/project before ranking and must never rely on vector similarity as authorization. Future metrics should include retrieval latency, candidate count, selected count, token cost, and relevance feedback without recording private text as labels.

## Interview prompts

- Why can a high cosine similarity still be irrelevant?
- How do approximate indexes trade recall for latency?
- Why should access filters run before or inside candidate generation?
- What retrieval benchmark would detect regressions beyond average latency?
- What workload evidence would justify extracting vector search from PostgreSQL?
