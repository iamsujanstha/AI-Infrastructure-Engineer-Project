# Transactions and Concurrency

## Transaction boundaries

Use one PostgreSQL transaction for one domain use case whose invariants span multiple rows. The client must be checked out once from `pg.Pool`; calling `pool.query('BEGIN')` and then issuing later statements through `pool.query` is incorrect because those calls can use different connections.

```ts
const client = await pool.connect();
let clientReleased = false;

try {
  await client.query('BEGIN');
  // Read/lock the conversation, allocate its sequence, write the message/parts,
  // update last_message_at, and persist any required run/context records.
  await client.query('COMMIT');
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    client.release(rollbackError instanceof Error ? rollbackError : new Error('Rollback failed'));
    clientReleased = true;
  }
  throw error;
} finally {
  if (!clientReleased) client.release();
}
```

This is a transaction pattern, not an implemented conversation service. Production helpers should preserve the original error if rollback also fails and destroy the bad connection as shown.

## Message append and concurrent writers

Allocate sequence and advance the optimistic version in the same transaction as inserting the message:

```sql
UPDATE conversations
SET next_message_sequence = next_message_sequence + 1,
    version = version + 1,
    last_message_at = clock_timestamp()
WHERE id = $1
  AND owner_user_id = $2
  AND deleted_at IS NULL
  AND version = $3
RETURNING next_message_sequence - 1 AS allocated_sequence, version;
```

No returned row means the conversation is missing, deleted, unauthorized for the supplied owner, or the caller's version is stale; the application should distinguish these cases without leaking cross-owner existence. The row update serializes sequence allocation for one conversation. Insert the message and its parts before commit; a failure rolls back the counter and prevents a visible gap.

Unique constraints still protect against duplicate `(conversation_id, sequence)` values. They are the final correctness boundary if two code paths implement allocation incorrectly.

## Isolation and locks

PostgreSQL defaults to `READ COMMITTED`: each statement sees a fresh committed snapshot. This is sufficient for many single-row compare-and-set operations and constraints, but two separate reads can observe different committed states. Use `SELECT ... FOR UPDATE` when a workflow must inspect and then mutate one row, or optimistic `version` checks when stale writes should fail and retry at the application boundary.

Use `SERIALIZABLE` only when the invariant spans predicates that constraints/locks do not adequately express. Serialization failures (`40001`) and deadlocks (`40P01`) require retrying the whole transaction with a bounded attempt count and jitter. The use case must be idempotent; do not repeat an external side effect inside a retried transaction.

## Consistency guarantees in this schema

- Unique indexes prevent duplicate active email, project slug, model key, message sequence, job idempotency key, and embedding-per-source/model combinations.
- Composite foreign keys enforce owner/project/conversation/message scope in storage.
- Check constraints enforce legal stored status values, nonnegative counts, vector dimensions, and the context window/output-reserve inequality.
- The migration runner commits a migration's DDL and ledger row together under an advisory lock.
- No PostgreSQL transaction can atomically commit a Redis/BullMQ job. A transactional outbox or explicit recovery protocol is needed when jobs are introduced.
- Inference provider calls must never occur while holding a database transaction open. Persist intent, release locks, call the provider, then persist the result with idempotency/cancellation rules.

## Pool and failure behavior

Every checked-out client must be released in `finally`. A transaction timeout, network failure, or process crash can leave the outcome unknown to the caller; use an idempotency key and query durable state before retrying. Keep transactions short, bound lock waits, and avoid streaming model output while holding locks.

The default isolation level and row locks do not make the entire application globally serial. They guarantee only the invariants protected by the statements, constraints, and lock scope in the transaction.
