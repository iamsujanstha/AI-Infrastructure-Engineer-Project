# Indexing Strategy

Indexes are derived from concrete access paths and integrity constraints. Each one speeds reads or enforces uniqueness at the cost of disk, cache, WAL, and write work. The indexes in migration `0002_core_data_model.sql` are a baseline for expected single-user/project access patterns, not proof that production queries are optimal.

## Index families in this schema

| Access pattern | Index choice | Reason |
| --- | --- | --- |
| Active account lookup by email | Unique expression B-tree on `lower(email)` with a `deleted_at IS NULL` predicate | Case-insensitive uniqueness and lookup without storing a second normalized email column. |
| User's active projects by recent update | `(owner_user_id, updated_at DESC, id DESC)` partial B-tree | Equality scope first, then the ordering/cursor keys. |
| Conversation list by owner | `(owner_user_id, last_message_at DESC, id DESC)` partial B-tree | Supports newest-first keyset pagination and excludes soft-deleted rows. |
| Messages in one conversation | Unique `(conversation_id, sequence)` B-tree | Enforces order and supports forward/backward sequence range scans. PostgreSQL can scan a B-tree backward for descending order. |
| Memories/documents in a scope | Composite owner/project/time B-trees with active predicates | Scope filters come first; recency and ID make stable cursors. A `NULL` project scope means user-level data. |
| Memory links and child rows | B-trees beginning with the parent FK | Finds dependents efficiently for joins and referential actions; PostgreSQL does not automatically index every referencing FK. |
| Text search over memory/chunk content | GIN over `to_tsvector('simple', content)` | Supports lexical candidate generation without an external search cluster. The `simple` configuration avoids assuming English stemming. |
| Jobs ready for work | Partial B-tree on `(queue_name, available_at, created_at)` for queued/delayed rows | Keeps the hot queue scan smaller. Redis/BullMQ delivery and job claiming are not implemented yet. |
| Slow/open inference requests | Partial/ordered B-trees on latency or nonterminal status | Supports diagnosis queries without indexing null latency or terminal rows unnecessarily. |

## Composite ordering and pagination

For owner lists use the same ordering as the index, for example `(last_message_at DESC, id DESC)`. A keyset cursor must contain both values:

```sql
SELECT id, title, last_message_at
FROM conversations
WHERE owner_user_id = $1
  AND deleted_at IS NULL
  AND (last_message_at, id) < ($2::timestamptz, $3::uuid)
ORDER BY last_message_at DESC, id DESC
LIMIT $4;
```

Offset pagination reads and discards earlier rows and can shift under concurrent inserts. Message history uses `sequence` as a stable cursor. Audit/usage lists use `(created_at, id)` because timestamps alone are not unique.

## Vector index decision

Embeddings are stored as pgvector values and their dimensions must match the recorded dimension. The schema does not create HNSW/IVFFlat yet: no embedding profile, dimension, distance metric, data volume, or recall/latency target has been selected. An index chosen against a guessed vector model could be invalid or wasteful. Before enabling approximate search, capture a representative retrieval corpus and benchmark exact-neighbor recall, p95 latency, build time, memory, and write cost.

The `embeddings_owner_model_dimensions_idx` index is metadata filtering, not a nearest-neighbor index. Similarity queries must first enforce user/project scope and then rank candidates; vector similarity is never an authorization check.

## Interview prompts

- Why does column order matter in a composite B-tree index?
- When can a partial index improve reads but add operational risk?
- Why can GIN accelerate search while making ingestion more expensive?
- How do you decide whether an observed sequential scan needs an index?

## How to validate an index

Use realistic data and the actual parameterized query shape:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, title, last_message_at
FROM conversations
WHERE owner_user_id = '00000000-0000-0000-0000-000000000001'
  AND deleted_at IS NULL
ORDER BY last_message_at DESC, id DESC
LIMIT 50;
```

`EXPLAIN ANALYZE` executes the query; use care with write statements. A sequential scan can be correct for a small table or low-selectivity predicate. Check estimated versus actual rows, buffer hits/reads, sort spill, and loops before adding an index. Keep statistics current with `ANALYZE`; do not assert that a specific index must always be selected.

## First likely index bottlenecks

GIN full-text indexes can grow quickly and make document ingest more expensive. The partial indexes on status reduce hot working sets but do not eliminate heap bloat from updates. Per-conversation message sequencing is intentional, but very high write concurrency on one conversation will serialize on the parent counter row. Revisit indexes from measured query plans and write amplification; do not index every JSONB field speculatively.
