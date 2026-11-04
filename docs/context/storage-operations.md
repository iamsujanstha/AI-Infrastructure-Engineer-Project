# Context graph storage operations

## What this feature does

The scanner and analyzers produce a local graph with source hashes, line ranges, graph node IDs and relationships. `context index` persists one validated artifact plus secret-screened text chunks in PostgreSQL. It writes both as an immutable generation and updates one head pointer only after every source, node, edge and chunk has been stored.

This is a local operator workflow. PostgreSQL search retrieves lexical graph facts and screened text chunks from the current published generation, then adds bounded same-generation neighbors. It does not generate embeddings or serve browser chat. The tenant and environment IDs are operator-supplied scope identifiers, not proof of the caller's identity. Chunk bodies are private source excerpts, not redacted text; secret-detection heuristics are imperfect.

## Setup and run

1. Set `DATABASE_URL` in the shell to the local PostgreSQL connection string. Never paste the password into a committed file or command transcript.
2. Install the locked Python dependencies with `cd apps/context-engine && uv sync --frozen`.
3. Run `npm run db:migrate -w @local-ai/api`. The existing migration runner applies additive migrations 0006–0008 and checks migration checksums. A one-entry compatibility checksum recognizes the already-applied pre-split Phase 5 draft of 0006; 0007 reconciles that schema. Do not edit applied migration SQL.
4. Initialize and scan the repository with the existing CLI, writing the artifact outside the scanned repository if practical.
5. Supply stable tenant/environment UUIDs to the index command:

```sh
npm run context -- init --root /path/to/project --name my-project
npm run context -- scan --root /path/to/project --output /tmp/my-project-scan.json
npm run context -- index --artifact /tmp/my-project-scan.json --root /path/to/project --tenant-id YOUR_TENANT_UUID --environment-id YOUR_ENVIRONMENT_UUID --environment-name local
npm run context -- storage search --tenant-id YOUR_TENANT_UUID --project-id YOUR_PROJECT_UUID --environment-id YOUR_ENVIRONMENT_UUID --query "ChatService" --limit 10
```

The tenant and environment IDs must be valid UUIDs. Project ID is taken from the graph's `.context-platform.json` source. Use the same IDs on later indexing runs. `--root` makes the CLI re-scan the approved root and compare its graph with the artifact before it persists chunks; it never trusts chunk text copied from an edited artifact. Omit `--root` only for legacy graph-only artifacts with no chunks. The CLI prints status, scope, generation/node/edge/chunk counts and manifest hash, not chunk contents.

`storage search` pins the environment's current published generation, runs parameterized name/attribute matching and PostgreSQL full-text plus literal-substring search across chunks, and returns source paths, hashes, line ranges, chunk text and up to five one-hop graph relationships per graph result. Results are local source excerpts. Ordinal rank is only ordering, not a relevance probability. The response explicitly reports `semantic_search: not_implemented`; embeddings and semantic retrieval remain open. There is no shared API or chat prompt compilation yet.

For recovery, rollback and removal:

```sh
# Intentional failure experiment: leave one committed batch in an unpublished generation.
npm run context -- index --artifact /tmp/my-project-scan.json --root /path/to/project --tenant-id TENANT_UUID --environment-id ENVIRONMENT_UUID --inject-interruption-after-checkpoints 1
# Rerun without the injection flag to resume and publish.
npm run context -- index --artifact /tmp/my-project-scan.json --root /path/to/project --tenant-id TENANT_UUID --environment-id ENVIRONMENT_UUID
# Roll the head back to a previously published generation.
npm run context -- storage rollback --tenant-id TENANT_UUID --project-id PROJECT_UUID --environment-id ENVIRONMENT_UUID --generation-id GENERATION_UUID
# Permanently delete one environment and all of its generations; confirmation must exactly match its UUID.
npm run context -- storage delete-environment --tenant-id TENANT_UUID --project-id PROJECT_UUID --environment-id ENVIRONMENT_UUID --confirm-environment-id ENVIRONMENT_UUID
```

## PostgreSQL inspection

Connect with pgAdmin at `http://127.0.0.1:5050` or with `psql` on port 5432, then run scoped queries. Replace the UUID literals with the values used by the CLI.

```sql
-- Current generation for this project/environment
SELECT h.tenant_id, h.project_id, h.environment_id, h.generation_id, h.updated_at,
       g.status, g.node_count, g.edge_count, g.coverage, g.manifest_hash
FROM context_platform.graph_heads AS h
JOIN context_platform.graph_generations AS g
  USING (tenant_id, project_id, environment_id, generation_id)
WHERE h.tenant_id = 'TENANT_UUID'
  AND h.project_id = 'PROJECT_UUID'
  AND h.environment_id = 'ENVIRONMENT_UUID';

-- Search exact node names in the pinned current generation
SELECT n.node_type, n.name, n.node_id, n.attributes, n.provenance
FROM context_platform.graph_heads AS h
JOIN context_platform.graph_nodes AS n
  USING (tenant_id, project_id, environment_id, generation_id)
WHERE h.tenant_id = 'TENANT_UUID'
  AND h.project_id = 'PROJECT_UUID'
  AND h.environment_id = 'ENVIRONMENT_UUID'
  AND n.name ILIKE '%Controller%'
ORDER BY n.node_type, n.name
LIMIT 100;

-- Inspect content saved for retrieval (keep this output private)
SELECT c.relative_path, c.chunk_index, c.line_start, c.line_end, c.content_sha256, c.content
FROM context_platform.context_chunks AS c
JOIN context_platform.graph_heads AS h
  USING (tenant_id, project_id, environment_id, generation_id)
WHERE h.tenant_id = 'TENANT_UUID'
  AND h.project_id = 'PROJECT_UUID'
  AND h.environment_id = 'ENVIRONMENT_UUID'
ORDER BY c.relative_path, c.chunk_index
LIMIT 20;

-- Inspect generation history without mixing generations
SELECT generation_id, status, node_count, edge_count, published_at
FROM context_platform.graph_generations
WHERE tenant_id = 'TENANT_UUID'
  AND project_id = 'PROJECT_UUID'
  AND environment_id = 'ENVIRONMENT_UUID'
ORDER BY published_at DESC;
```

Every retrieval statement includes the full scope and current generation. A node or chunk row from an older generation is not part of the current result unless the head references that generation. PostgreSQL stores the approved scan's chunk excerpts; protect the database and pgAdmin like the source repository. Files rejected by the scanner have no chunks.

## Publication and recovery flow

```text
scan and secret-screen -> chunk eligible text -> re-scan root at index time -> validate graph/chunk hashes -> canonical manifest hash
    -> scoped runtime role + session advisory lock
    -> insert generation -> commit source/chunk/node/edge batches with hash checkpoints
    -> verify persisted counts -> mark published and switch graph_heads atomically
```

If a batch write fails before commit, that batch and checkpoint roll back while earlier committed batches remain staged and invisible through `graph_heads`. Rerun the same artifact to validate and resume those batches. If the client loses the final success response after commit, the retry returns `already_published`. A changed scan gets a new manifest and generation. Rollback changes only the head pointer; it does not mutate either generation. Environment deletion cascades to all generations, checkpoints and graph rows after exact UUID confirmation.

Partial scan coverage is persisted with `status=partial` and coverage counters. The local search returns that status; callers must treat results from partial generations as incomplete. The lexical/graph command returns facts from the graph and is not a natural-language answer or a compiled model prompt.

## Failure experiment

Use a disposable project and a non-production database:

1. Index the same artifact twice and confirm only one generation exists for the manifest and both commands resolve the same head.
2. Index two artifacts for one scope concurrently and confirm the advisory transaction lock serializes publication and the head references one committed generation.
3. Use the bounded interruption flag after a committed batch, confirm the head did not move, rerun and confirm checkpoint resume.
4. Change an edge endpoint to a nonexistent node or another scope and confirm validation or the composite foreign key rejects it.
5. Confirm the `context_runtime` role cannot see another environment or update/delete graph nodes; the `platform` owner can bypass RLS.
6. Roll back to an earlier published generation and confirm the head; delete the disposable environment and confirm its graph rows/checkpoints cascade away.

Executed 2026-11-04: migrations applied to the existing database and a fresh temporary database; the fresh database was dropped afterward. A disposable graph indexed and re-indexed idempotently; an injected stop after one checkpoint resumed and published; two concurrent index calls converged on one generation; RLS hid an alternate environment and the runtime role lacked graph-node UPDATE/DELETE privileges; an invalid edge target was rejected with SQLSTATE 23503; head rollback and environment deletion succeeded. Load limits have not been measured.

## What remains to implement

- Provision organization/project membership and authenticated identity before accepting remote/shared project requests.
- Add database login/role provisioning per deployment; local migration provisions the NOLOGIN runtime group and the CLI switches into it.
- Add a fencing-token lease if indexing moves to workers that can outlive the current database session lock.
- Define retention, source tombstone and audit behavior before automatic garbage collection.
- Complete retrieval with normalized source chunks, evaluated semantic/hybrid search, authorization labels and runtime isolation evidence.
- Add a deterministic context compiler before injecting retrieved items into model prompts.
- Keep browser chat and Hermes disconnected from this operator-only search until their identity and authorization boundaries are implemented.

Read [ADR-016](../decisions/ADR-016-atomic-context-graph-generations.md) for the decision, alternatives, edge cases, scale considerations and interview questions.
