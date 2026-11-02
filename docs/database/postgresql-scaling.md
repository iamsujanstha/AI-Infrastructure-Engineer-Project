# PostgreSQL Scaling and Limits

## Start with a connection budget

`pg.Pool` is process-local. The rough upper bound is:

```text
API replicas × PG_POOL_MAX + migration workers + admin/monitoring clients
```

The default pool maximum is 10 per API process. Before adding replicas, compare the aggregate with PostgreSQL's connection limit and reserved administrative capacity. Too many connections consume memory and increase scheduling overhead. A pooler can help, but transaction-pooling mode changes session behavior and must be evaluated carefully.

The migration runner holds a PostgreSQL session advisory lock. It must use a direct or session-affine connection; a transaction-pooling proxy can move statements between server sessions and invalidate that lock assumption.

## Expected bottlenecks

1. **Connection saturation:** requests wait for a pool client while slow queries hold connections. Track pool checkout wait, active/idle clients, and DB latency before increasing `PG_POOL_MAX`.
2. **Hot rows:** allocating a strict per-conversation message sequence updates one conversation row. One very active conversation serializes writers even when the table has many partitions/shards.
3. **Read amplification:** unbounded JSONB predicates, offset pagination, or N+1 repository calls can dominate before raw disk capacity does.
4. **Index write cost:** each additional B-tree/GIN index increases insert/update WAL, storage, vacuum, and cache pressure.
5. **Vector memory/build cost:** ANN index choice and dimensions affect build time, recall, RAM, and write behavior. Benchmark against a real corpus before selecting HNSW or IVFFlat.

## Growth strategy

- Keep one PostgreSQL primary while one team's write/load and recovery objectives fit it. Scale up and tune queries/indexes before adding distributed data ownership.
- Add a pooler or a separate read path only after connection or read load is measured. Read replicas introduce replication lag; never route a read-after-write workflow to a lagging replica without an explicit stale-read contract.
- Partition append-heavy `audit_logs`, `usage_records`, or `inference_requests` only when retention, table size, and pruning operations justify partition complexity. Choose partition keys around retention and query filters; partitioning does not automatically speed every query.
- Apply retention and archival policy before old inference telemetry dominates storage. Preserve audit and legal records according to an explicit policy.
- Keep document binaries outside PostgreSQL; store metadata and text chunks relationally, then revisit storage if corpus size or ingestion pattern requires it.
- Do not shard on user ID before a measured single-primary limit; sharding complicates foreign keys, transactions, search, and migrations.

## Operations and recovery

The health probe proves only that `SELECT 1` succeeds. It does not prove low latency, free disk, replication health, backup recency, or ability to restore. Production needs monitored disk/WAL capacity, scheduled backups, point-in-time recovery, restore drills, migration roll-forward plans, and defined RPO/RTO. The Compose named volume is local persistence, not backup.

Use `EXPLAIN (ANALYZE, BUFFERS)` on representative queries; review sequential scans in context rather than assuming they are errors. Track query latency percentiles, rows examined/returned, dead tuples, autovacuum, lock waits, connection usage, WAL, and replication lag if replicas are added.

## Security and consistency

Database credentials belong to server-side secret management and separate runtime/migration roles. Database ownership filters must remain in SQL even after authentication is implemented. A read replica can return stale state, and a pooler can change session semantics; both are consistency decisions, not transparent capacity switches.

## Staff-level interview prompts

- At what measured point would you increase pool size, and when would that make queueing worse?
- Why can a hot conversation row remain the bottleneck after adding indexes?
- What does partition pruning require from the query predicate?
- How do WAL, replicas, backups, and point-in-time recovery fit together?
- When is a sequential scan the optimal plan?
- What consistency guarantees change when reads move to a replica?
