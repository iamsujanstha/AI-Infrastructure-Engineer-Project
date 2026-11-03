# Failure experiments and recovery gates

Planned experiments; none are claimed executed in Phase 0. Use dedicated fixture directories and disposable test containers/databases. Never stop a shared customer service for these checks.

| Failure | Expected observation and recovery |
| --- | --- |
| FastAPI stopped or stalled | Nest returns bounded 503/504 with request/trace IDs; restore service and verify next request |
| PostgreSQL unavailable | Process liveness remains distinct from readiness; no partial publication; restore and resume checkpoint |
| pgvector missing | Migration/readiness for semantic capability fails explicitly; lexical-only mode requires explicit caller approval |
| Invalid root, symlink escape, binary or huge file | Deterministic safe rejection/skip reason; no read outside approved root |
| Corrupt/unsupported source or parser crash | Isolated per-source failure, honest partial status; retry corrected source |
| Secret canary | Excluded/sanitized before every output sink; no value in errors/logs |
| Embedding error | Stage marked failed/incomplete; no generation pointer swap; recover missing batches |
| Duplicate/concurrent index request | Same key/digest converges; conflicting key rejected; fencing prevents stale publish |
| Worker/process killed during indexing | Durable per-item checkpoints, expiring lease and fenced resumption; readers retain old complete generation |
| Unauthorized query/forged permit | Reject before retrieval; no source/count/neighbor leakage |

Each experiment records setup, exact command/test, expected invariant, observed result, failure/detection/recovery timestamps, sanitized evidence and cleanup. Metrics come from measured events: scan/index durations, files scanned/skipped, parser failures, sanitized findings, nodes/edges/chunks/vectors, retrieval/compile and service HTTP latency. Include request_id/project_id/trace_id in correlated logs; avoid these unbounded IDs and private paths as metric labels. Retention and access are explicit.

At load, parser/embedding CPU and memory, graph fanout, database I/O and HTTP admission are bounded separately. Cap concurrent work per tenant/project; enforce fair quotas and backpressure. Measure before adopting Redis or separate workers. No SLO or throughput number is claimed until an agreed repository corpus is measured.

