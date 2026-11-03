# ADR-014: Local Hermes project-context MCP adapter

- **Status:** Accepted for local development; not a Phase 10 completion claim
- **Date:** 2026-11-03

## Context

The current local MLX chat generates raw responses and does not retrieve project context. Hermes is a separate agent runtime and needs a narrow way to inspect the current context engine without unrestricted shell or database access. Durable storage, identity, authorization-scoped retrieval, and the context compiler are still future phases.

## Decision

Provide a local stdio MCP server over the Phase 4 scanner and graph. Configure one operator-selected repository root through `CONTEXT_PROJECT_ROOT`. Expose only scan overview, screened literal file search, and graph symbol search. Do not add network access, API tokens, arbitrary root arguments, write tools, or model-provider coupling.

## Consequences

- Hermes can call local project-context tools and incorporate returned provenance into an answer.
- The server is single-root, single-operator, in-memory, lexical, and stale until restarted. It is not a replacement for the planned authenticated `AgentContextProvider`.
- The first tool call performs a bounded scan; multiple Hermes server processes repeat the work.
- The browser chat remains separate. Hermes uses its own configured provider/model; this integration does not configure MLX for Hermes.
- Before shared use, add durable indexing, authenticated scope enforcement, retrieval evaluation, context compilation, and documented failure/recovery evidence.

## Alternatives considered

- **Shell access:** rejected because it grants a much broader capability than project search.
- **HTTP MCP:** deferred because it adds a network and authentication boundary that the current local-only context service does not provide.
- **Wait for full context platform phases:** retained as the production path, but a local adapter is useful now and clearly labeled with the current limits.
