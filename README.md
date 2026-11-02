# Local AI Agent Infrastructure & Memory Platform

A private engineering workspace for learning and operating the systems beneath AI agents: bounded context construction, persistent memory, retrieval, agent/provider adapters, inference, jobs, data consistency, security, and reliability.

The frontend is a control plane. The core engineering problem is turning a large body of persistent knowledge and conversation into a small, relevant, explainable, model-bounded inference request.

## Core distinctions

```text
Persistent memory ≠ conversation history ≠ retrieved context ≠ inference context window
```

Logical knowledge may grow over time. Each individual inference request must remain within the selected model's context limit, with output capacity reserved. Context limits are managed; they are not removed.

## Current status

Phases 0–1 established the engineering contract and runnable web/API foundation. Phase 2 adds the PostgreSQL core schema, scope-safe relational constraints, query indexes, pgvector storage, and a checked-in SQL migration runner using raw `pg`. Application repositories and domain workflows are still future work. See [local development](docs/infrastructure/local-development.md) and the [database model](docs/database/data-model.md).

## Architecture direction

Begin with a modular monolith and explicit provider/agent interfaces. PostgreSQL is the durable system of record; Redis is provisioned for later jobs, and pgvector is installed for later retrieval work. Queue semantics and inference adapters will be implemented only when their phases define the required contracts. Keep local inference independently configurable so the control plane does not depend on one host or model.

See [the system overview](docs/architecture/system-overview.md), [the engineering contract](AGENTS.md), and [the engineering journal](docs/engineering-journal.md).

## Phased delivery

Work incrementally, completing and reviewing one phase before starting the next. Phase 0 is the contract. Later phases should establish a runnable foundation, then add data, conversation, context, memory, retrieval, agent/inference, jobs, security, observability, and deployment capabilities with evidence appropriate to each milestone.

For any completed phase, report what exists, what was verified, what remains unverified, the decision tradeoffs, and the next proposed phase. Do not infer completion from this roadmap.

## Local development

See [local development](docs/infrastructure/local-development.md) for prerequisites, configuration, startup, readiness, and verification commands. Never put real credentials in the repository.

## Learning approach

For major subsystems, explain the problem, constraints, design, alternatives, failure behavior, scaling pressure, consistency guarantees, security implications, observability, and interview-level reasoning. Record actual implementation lessons and incidents in the engineering journal; do not fabricate operational evidence.
