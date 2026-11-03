# Architecture Decision Records

Store durable technology and boundary decisions here. Each ADR should state its status, context, constraints, options considered, decision, consequences, failure and scaling implications, security and observability concerns, and interview prompts. Do not record a planned choice as accepted before evaluating its requirements.

## Active project-context proposal (2026-11-03)

Existing ADR-001/002/003/005 record the previous foundation; applied migrations and raw pg remain in place. New IDs avoid replacing that history.

- [ADR-006: NestJS control plane](ADR-006-context-control-plane.md)
- [ADR-007: FastAPI and shared Python core](ADR-007-python-context-engine.md)
- [ADR-008: Project-context PostgreSQL storage](ADR-008-project-context-storage.md)
- [ADR-009: V1 scope and dependency discipline](ADR-009-context-v1-scope.md)

These are Phase 0 design proposals, not claims of runtime implementation. Embedding model, parser coverage, internal identity implementation, customer authentication, Atlas path/revision and performance targets are implementation validation gates.
