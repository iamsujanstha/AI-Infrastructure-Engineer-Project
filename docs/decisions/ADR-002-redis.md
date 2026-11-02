# ADR-002: Redis for Volatile Operational State and Future Jobs

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

The target system needs asynchronous work for embedding, consolidation, and other operations. Redis and BullMQ are specified for a later jobs phase. Phase 1 needs to make local Redis startup, connectivity, readiness, and shutdown behavior concrete without prematurely defining job delivery guarantees.

## Decision

Run Redis 7 locally through Compose with loopback-only port publishing and append-only persistence. The API owns a lazy Redis connection and `/health/redis` performs `PING`. No queue, cache, or application data is stored in Redis yet. BullMQ configuration and job semantics require a separate implementation and decision in the jobs phase.

## Alternatives considered

- **In-process memory:** Fewer dependencies, but state disappears on restart and cannot support shared asynchronous work across processes.
- **PostgreSQL-backed jobs:** Fewer systems and transactional enqueue can be valuable, but the brief selects Redis/BullMQ and job throughput/retention semantics have not yet been designed.
- **Kafka/RabbitMQ:** Stronger broker and replay options, but add operational complexity without an event-log or throughput requirement. They are explicitly out of the initial architecture.

## Consequences and tradeoffs

- Redis is operational state, not the durable source of truth. Redis failure must not erase PostgreSQL-owned conversations or memories.
- Phase 1's API remains live during a Redis outage, but readiness returns 503. Queue behavior cannot be claimed yet because no worker or job is implemented.
- AOF and a named local volume improve local restart behavior but are not a backup/restore plan or a production durability guarantee.
- Multi-replica APIs share one Redis service, but Redis becomes a capacity and availability dependency. Queue retries, duplicate delivery, idempotency, dead letters, and eviction policy must be designed before BullMQ is enabled.

## Security and observability

Local Redis is unauthenticated but only published to loopback. Production configuration rejects unauthenticated non-TLS Redis URLs; network policy and managed secret handling are still required. The readiness probe reports only a coarse result and does not expose credentials or internal addresses.

## Interview prompts

- Which state is safe to keep only in Redis?
- What does a successful Redis `PING` prove, and what does it not prove about BullMQ?
- How do retries produce duplicate work, and where should idempotency live?
- How do AOF, snapshots, replication, and backups differ as recovery mechanisms?
- When would a transactional outbox be needed between PostgreSQL and a queue?
