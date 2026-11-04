# Architecture Decision Records

Store durable technology and boundary decisions here. Each ADR should state its status, context, constraints, options considered, decision, consequences, failure and scaling implications, security and observability concerns, and interview prompts. Do not record a planned choice as accepted before evaluating its requirements.

## Active project-context proposal (2026-11-03)

Existing ADR-001/002/003/005 record the previous foundation; applied migrations and raw pg remain in place. New IDs avoid replacing that history.

- [ADR-006: NestJS control plane](ADR-006-context-control-plane.md)
- [ADR-007: FastAPI and shared Python core](ADR-007-python-context-engine.md)
- [ADR-008: Project-context PostgreSQL storage](ADR-008-project-context-storage.md)
- [ADR-009: V1 scope and dependency discipline](ADR-009-context-v1-scope.md)
- [ADR-010: Version-locked static analyzer toolkit](ADR-010-static-analyzer-toolkit.md)
- [ADR-011: Deterministic local context graph](ADR-011-context-graph.md)
- [ADR-012: Local MLX inference adapter](ADR-012-local-mlx-inference.md)
- [ADR-013: Local browser chat](ADR-013-local-browser-chat.md)
- [ADR-016: Atomic context graph generations](ADR-016-atomic-context-graph-generations.md)
- [ADR-017: Scoped local graph retrieval](ADR-017-local-graph-retrieval.md)

ADR-006 through ADR-009 are Phase 0 design proposals. ADR-010 records the parser choice validated during Phase 3; ADR-011 records the Phase 4 graph representation and local query boundary. ADR-012 records the user-approved local raw-generation prototype and one successful Metal-backed generation/recovery experiment. ADR-013 records the loopback browser chat and replaceable inference-provider port; its origin check is not user authentication, and it does not provide project context. ADR-016 records the completed local storage workflow, PostgreSQL experiments, and the remaining identity, retention and scale boundaries. Embedding model, scoped context APIs, Atlas path/revision and performance targets remain implementation validation gates.
