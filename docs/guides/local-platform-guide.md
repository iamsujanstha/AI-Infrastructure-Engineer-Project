# Local Platform Guide: Tools, Data, Flows, and Roadmap

This guide explains what is running today, where its data lives, how to inspect it, and what to build next. It separates working behavior from schema and architecture that are only groundwork.

## Start with these distinctions

The word “memory” is used for different systems. They do not share storage automatically.

| Data | Stored in | What it does here |
| --- | --- | --- |
| Browser chat transcript | PostgreSQL: `conversations`, `messages`, `message_parts` | The local web chat reloads saved conversations and sends recent completed turns to MLX. This is app conversation history, not Hermes memory. |
| Platform memory records | PostgreSQL: `memories`, `memory_links` | The schema exists, but the product does not yet have an implemented memory write/retrieval workflow. |
| Project source graph | Local scanner output and the Hermes MCP process’s in-memory scan snapshot | Represents analyzed files/symbols with source paths and line ranges. The current graph is not a durable shared index. |
| Hermes conversation history | SQLite: `~/.hermes/state.db` | Hermes saves its own sessions and message history. It is independent from the browser app’s PostgreSQL conversations. |
| Hermes curated memory | Files: `~/.hermes/memories/MEMORY.md` and `USER.md` | Small notes/profile that Hermes can carry between sessions. They are not a copy of every conversation. |
| Model context window | Sent with an individual inference request | Bounded prompt input for one model call. It is not persistent storage. |

The current local Hermes tool server only reads screened project files and graph metadata. It does not send browser chat messages to Hermes or write messages to Hermes memory. Hermes session history and curated memory are separate features; see the [official session guide](https://hermes-agent.nousresearch.com/docs/user-guide/sessions) and [memory guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory).

## What is implemented today

| Component | Technology | Current role and limit |
| --- | --- | --- |
| Web UI | Next.js, React, Tailwind CSS | Local model chat, saved conversation selection, Markdown response rendering. The chat is not yet grounded in project sources. |
| API | NestJS, TypeScript | Validates local chat requests, enforces a prompt budget, persists conversation turns, and calls the replaceable inference-provider interface. The local owner is server-defined; this is not login/authentication. |
| Relational store | PostgreSQL 17 with `pg` and checked-in SQL migrations | Durable application records and conversation text. One named Docker volume preserves data across normal container restarts. |
| Vector extension | pgvector inside PostgreSQL | The extension and dimension-aware `embeddings` table exist. There is no implemented project embedding/retrieval workflow or ANN vector index yet. It is not a separate database server. |
| Context engine | FastAPI, Python 3.12, Tree-sitter analyzers | Runtime and authenticated health endpoints exist. Repository analysis currently runs through the local CLI/MCP integration; the context engine does not expose a project search API yet. |
| Context CLI | TypeScript launcher + Python scanner/analyzers | Scans a selected checkout, screens likely secrets, creates versioned facts/graph, and queries a saved local artifact. |
| Local inference | MLX-LM on Apple Silicon | Separate host process, default port 8080. The browser chat sends raw conversation context; it does not retrieve project files. |
| Hermes integration | Hermes Agent + local stdio MCP server | Hermes can call three read-only project-context tools. Stdio means there is no MCP port to visit. |
| Redis | Redis 7, optional legacy Compose profile | Health/persistence scaffold only for this project flow; chat and context retrieval do not currently depend on a Redis queue. |

The distinction between “schema exists” and “feature works” matters. For example, `memories`, `documents`, `document_chunks`, and `embeddings` are database tables; that alone does not mean the UI writes memories or searches vectors.

## Ports and addresses

| Service | Local address | How to use it |
| --- | --- | --- |
| Web app | [http://127.0.0.1:3000](http://127.0.0.1:3000) | Open this in the browser. |
| NestJS API | `http://127.0.0.1:4000` | API and liveness/readiness routes; interactive OpenAPI reference at `/docs`, JSON at `/docs/openapi.json`. |
| PostgreSQL | `127.0.0.1:5432` | Connect with `psql`, DBeaver, TablePlus, or pgAdmin. Published on loopback only. |
| pgAdmin | [http://127.0.0.1:5050](http://127.0.0.1:5050) | Browser UI for PostgreSQL. Sign-in and connection settings come from `.env`; the service directory never returns passwords. |
| FastAPI context engine | `http://127.0.0.1:8000` | OpenAPI reference at `/docs`, JSON at `/openapi.json`; `/health` and authenticated `/internal/health`; no project retrieval endpoint yet. |
| Redis (optional) | `127.0.0.1:6379` | Only when started with the `legacy` Compose profile. |
| MLX-LM | `http://127.0.0.1:8080` | Host-run inference server; `/v1/models` shows the model IDs it currently serves. |
| Hermes MCP server | No TCP port | Hermes starts `apps/context-engine/hermes_mcp.py` over local stdio. |

The browser uses `127.0.0.1` by default. Keep the same hostname in the browser and API configuration; `localhost` and `127.0.0.1` are different browser origins.

## Start the local system

From the repository root:

```sh
cp .env.example .env
npm ci
docker compose up -d postgres context-engine pgadmin
npm run db:migrate -w @local-ai/api
npm run dev
```

The web/API processes run on the host. PostgreSQL and the context-engine container bind to loopback. Redis is optional:

```sh
docker compose --profile legacy up -d redis
```

For the scanner/graph CLI, install the locked Python environment once:

```sh
cd apps/context-engine
uv sync --frozen --python 3.12
cd ../..
npm run build -w @local-ai/context-cli
```

For local MLX inference, install MLX-LM in a compatible Apple Silicon Python environment and start its host process in another terminal:

```sh
HF_HUB_OFFLINE=1 mlx_lm.server --model mlx-community/Qwen3-8B-4bit
```

The MLX server defaults to loopback port 8080. The model must already be cached for offline mode. Full MLX configuration and the CLI workflow are in [Local MLX inference](../infrastructure/mlx-inference.md).

Check running services and health:

```sh
docker compose ps
curl -i http://127.0.0.1:4000/health
curl -i http://127.0.0.1:4000/health/database
curl -i http://127.0.0.1:4000/health/context-engine
curl -i http://127.0.0.1:8000/health
curl -i http://127.0.0.1:8080/v1/models
```

The API also has `/health/redis` and `/health/inference`. Health results are real checks; `503` means the corresponding dependency is unavailable or unconfigured. The context engine’s `/health` is liveness; `/internal/health` requires its bearer token. Neither is project search.

## Open the service directory and connect pgAdmin

Open the formatted service directory at [http://127.0.0.1:3000/services](http://127.0.0.1:3000/services). It reads the NestJS endpoint `GET http://127.0.0.1:4000/api/v1/system/services` and presents browser links, API docs, TCP connection addresses, start commands, and the Hermes stdio entry as cards. Connection fields and commands can be copied. The raw JSON stays available for integrations, and the endpoint also appears under **System** in NestJS Swagger at `http://127.0.0.1:4000/docs`. The catalog reports configuration rather than claiming that services are healthy.

Open [pgAdmin](http://127.0.0.1:5050) and sign in with `PGADMIN_DEFAULT_EMAIL` and `PGADMIN_DEFAULT_PASSWORD` from the root `.env` file. When adding the PostgreSQL server, use a name such as `Local AI Platform`, host `postgres` (the Compose DNS name from inside pgAdmin), port `5432`, maintenance database `local_ai_platform`, username `platform`, and the matching `POSTGRES_PASSWORD`. From a desktop database client outside Compose, use host `127.0.0.1` instead. The service-directory response includes both the pgAdmin URL and the connection fields, but deliberately omits password values.

## Follow one browser chat turn

~~~mermaid
sequenceDiagram
    participant Browser as Next.js browser UI
    participant API as NestJS chat API
    participant DB as PostgreSQL
    participant MLX as MLX-LM host server
    Browser->>API: GET saved conversations / POST a turn
    API->>DB: owner-scoped conversation and messages
    API->>DB: persist user prompt + pending assistant row
    API->>MLX: provider-neutral request with recent history and budget
    MLX-->>API: assistant text
    API->>DB: persist and finalize assistant response
    API-->>Browser: saved user/assistant message records
~~~

The chat routes are under `/api/v1/chat`:

- `GET /conversations`: list the local owner’s active chats.
- `POST /conversations`: start a chat.
- `GET /conversations/:id/messages`: restore recent messages.
- `POST /conversations/:id/turns`: persist a user turn and generate its answer.
- `GET /models`: ask the live inference provider which models are available.

On a provider failure, the submitted prompt remains stored and the assistant message is marked failed. The model receives up to 49 completed previous user/assistant pairs plus the new prompt; the API applies its configured context budget. A new chat starts an independent history.

The local browser flow uses a fixed server-side development owner ID so you do not enter a token. The loopback/origin guard is not authentication: other local processes can call the API. Do not expose these ports to another device or use this as a multi-user deployment.

## Inspect PostgreSQL with psql or a database GUI

### Connect

The easiest connection does not expose a database password in your shell:

```sh
docker compose exec postgres psql -U platform -d local_ai_platform
```

For an inspection session, make the transaction read-only before running SQL and finish with `ROLLBACK;` (then `\q` to exit). Avoid update/delete statements while learning the schema.

For DBeaver, TablePlus, or pgAdmin, use host `127.0.0.1`, port `5432`, database `local_ai_platform`, user `platform`, and the password from your local `.env`/Compose configuration. The checked-in Compose password is a development placeholder only; do not reuse it outside localhost.

### Inspect normal tables and migration history

Inside `psql`:

```sql
\conninfo
\dx
\dt
\d+ conversations
\d+ messages
\d+ message_parts
\d+ embeddings

SELECT migration_name, applied_at
FROM _platform_schema_migrations
ORDER BY migration_name;
```

The `\d+` commands show columns, constraints, and indexes. The migration runner applies numbered SQL files from `apps/api/migrations`, records checksums in `_platform_schema_migrations`, and rejects edits to already-applied files. Add a new numbered migration for future schema changes; do not edit a migration that has already run.

### Inspect saved app conversations

The local web app owner is created by the API as needed. This query lists its conversations without printing message content:

```sql
SELECT c.id, c.title, c.status, c.created_at, c.last_message_at,
       count(m.id) AS message_count
FROM conversations AS c
LEFT JOIN messages AS m
  ON m.conversation_id = c.id AND m.owner_user_id = c.owner_user_id
WHERE c.owner_user_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND c.deleted_at IS NULL
GROUP BY c.id
ORDER BY c.last_message_at DESC;
```

To inspect one transcript, substitute a conversation ID from the first query. This returns private prompts and model responses, so run it only on your machine:

```sql
SELECT m.sequence, m.role, m.status, p.part_index, p.text_content, m.created_at
FROM messages AS m
LEFT JOIN message_parts AS p ON p.message_id = m.id
WHERE m.conversation_id = '<conversation-uuid>'::uuid
  AND m.owner_user_id = '00000000-0000-4000-8000-000000000001'::uuid
ORDER BY m.sequence, p.part_index;
```

The browser chat currently has no per-chat delete/retention screen. Its records remain in PostgreSQL until an operator removes them or resets the local database. `docker compose down` keeps the data volume; `docker compose down -v` deletes the volumes and is destructive.

### Inspect pgvector and embeddings

pgvector is an extension in the same PostgreSQL database. Check whether it is installed and whether rows exist:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

SELECT embedding_model, dimensions, count(*) AS rows
FROM embeddings
GROUP BY embedding_model, dimensions
ORDER BY embedding_model, dimensions;

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'embeddings'
ORDER BY indexname;
```

An embedding row has a model name, a dimension count, one `memory_id` or one `document_chunk_id`, and a `vector` value. Use the same model and exact dimension for a similarity query, and filter by the authorized owner/project before returning candidates. For example, this is the shape of a parameterized cosine-distance query; `$1` must be a real vector generated by the same embedding model and `$2`–`$4` must come from trusted scope/configuration:

```sql
PREPARE scoped_vector_search (vector, uuid, uuid, text, integer) AS
SELECT e.id, e.memory_id, e.document_chunk_id,
       e.embedding <=> $1 AS cosine_distance
FROM embeddings AS e
LEFT JOIN memories AS m
  ON m.id = e.memory_id AND m.owner_user_id = e.owner_user_id
LEFT JOIN document_chunks AS ch
  ON ch.id = e.document_chunk_id AND ch.owner_user_id = e.owner_user_id
LEFT JOIN documents AS d
  ON d.id = ch.document_id AND d.owner_user_id = ch.owner_user_id
WHERE e.owner_user_id = $2
  AND COALESCE(m.project_id, d.project_id) = $3
  AND e.embedding_model = $4
  AND e.dimensions = vector_dims($1)
  AND ((m.id IS NOT NULL AND m.status = 'active' AND m.deleted_at IS NULL)
       OR (d.id IS NOT NULL AND d.deleted_at IS NULL))
ORDER BY e.embedding <=> $1
LIMIT $5;
```

This example demonstrates PostgreSQL syntax only. After preparing it, execute it with actual values:

```sql
EXECUTE scoped_vector_search(
  '<full model-sized vector>'::vector,
  '<owner-uuid>'::uuid,
  '<project-uuid>'::uuid,
  '<embedding-model-id>',
  10
);
DEALLOCATE scoped_vector_search;
```

Replace every placeholder; the vector must have exactly the selected model’s dimension. The project does not yet generate project embeddings or expose vector retrieval, and no HNSW/IVFFlat index is defined in the current migration. A vector table and extension do not equal a working vector-search feature. Without an ANN index, similarity ordering scans candidate rows; choose the embedding model/dimension and measure quality/workload before adding one. Do not query all owners in a shared deployment.

## Scan a codebase and inspect its graph

The scanner is a local CLI, not the FastAPI server. It reads a chosen checkout without executing repository code, excludes credential-like files and directories, and produces source-backed facts. Start from a checkout you are allowed to inspect:

```sh
npm run context -- init --root "$PWD" --name ai-infrastructure-engineer-project
mkdir -p .context-platform
npm run context -- scan --root "$PWD" --output .context-platform/scan.json
npm run db:migrate -w @local-ai/api
npm run context -- index --artifact .context-platform/scan.json --root "$PWD" --tenant-id TENANT_UUID --environment-id ENVIRONMENT_UUID
npm run context -- storage search --tenant-id TENANT_UUID --project-id "$(node -p 'require("./.context-platform.json").project_id')" --environment-id ENVIRONMENT_UUID --query "ChatService"
```

The initialization creates `.context-platform.json` in the selected root. The scan artifact includes discovery, analyzer results, graph nodes/edges, source hashes, line provenance and screened source chunks. At index time, `--root` causes a fresh scan; the CLI compares its graph with the supplied artifact and persists only the freshly generated chunks. Replace `TENANT_UUID` and `ENVIRONMENT_UUID` with stable UUIDs for this local scope. A `partial` status means some files were unsupported, failed, or hit a limit; it is not an empty or fully understood project. Scan artifacts and PostgreSQL chunks contain private repository excerpts. Avoid committing artifacts and protect pgAdmin/database access.

Example bounded graph queries:

```sh
npm run context -- graph find \
  --artifact .context-platform/scan.json \
  --type class --name ChatService

npm run context -- graph traverse \
  --artifact .context-platform/scan.json \
  --node-id '<node-uuid>' --depth 2 --limit 100
```

Graph-file queries remain available against artifacts. PostgreSQL `storage search` uses the current published generation to search facts and source chunks, returning paths, line ranges and excerpts with bounded graph neighbors. It is local lexical/graph retrieval; semantic embeddings, authorization labels and prompt compilation are not implemented, and the browser chat/Hermes MCP do not use this query. More detail: [scanner guide](../context/project-scanner.md), [storage guide](../context/storage-operations.md), [analyzer guide](../context/analyzers.md), and [graph guide](../architecture/context-graph.md).

## Use Hermes with project context

The local MCP registration is `project-context`. It launches `apps/context-engine/hermes_mcp.py` via stdio and sets a fixed `CONTEXT_PROJECT_ROOT`. It does not listen on port 8000 or 4000.

Check it from a terminal:

```sh
hermes mcp list
hermes mcp test project-context
hermes memory status
hermes sessions list
```

The project-context server currently exposes:

1. `project_context_overview`: real scan/graph coverage.
2. `search_project_context`: literal, case-insensitive search with short excerpts and source locations, limited to files accepted by the scanner’s screening rules.
3. `find_project_symbols`: literal graph-name search with source paths and line ranges.

Ask Hermes to use the project-context tools for a project-specific question and to include returned file paths/lines in its answer. If the server command or checkout path changes, update its registration with `hermes mcp add`; use `hermes mcp configure` to change which discovered tools are enabled. Then reload MCP tools or start a new Hermes session. The process keeps one in-memory snapshot; restart/reload it to rescan changed files.

Hermes stores its full agent sessions separately from notes. The default-profile SQLite database is `~/.hermes/state.db`; use `hermes sessions list`, `hermes sessions stats`, `hermes --continue`, or a session export to inspect/manage history. To inspect the database locally without opening it for writes:

```sh
sqlite3 -readonly ~/.hermes/state.db '.tables'
sqlite3 -readonly ~/.hermes/state.db 'SELECT id, source, title, started_at FROM sessions ORDER BY started_at DESC LIMIT 10;'
```

The `messages` table contains session message contents; querying it prints private prompts and tool results. Hermes curated notes live in `~/.hermes/memories/MEMORY.md` and `USER.md`; inspect those files locally only if needed. Run `hermes memory status` to see whether built-in curated memory and any external provider are enabled. The local MCP server does not write the app transcript into Hermes’ database or note files. Do not commit `.hermes/config.yaml`, memory files, SQLite files, or session exports; they may contain private data or credentials.

## How to build the missing project-context capability

The browser chat and the codebase-context pipeline are currently separate. Build the backend capability in this order before connecting it to the UI or external SDK:

| Next phase | Problem it solves | Deliverable |
| --- | --- | --- |
| 5 — durable context storage | Local graph snapshots disappear with the process and are not shared/reproducible | Additive `context_platform` schema, source/generation records, scoped access, checkpoints, duplicate/concurrent indexing behavior, deletion and rollback. Keep existing conversation tables separate. |
| 6 — authorized retrieval | A graph alone cannot find the best source evidence for a natural-language question | Structured, lexical, semantic, graph, and hybrid retrieval. Apply owner/project/environment/permission filters before candidate ranking; record embedding failures. |
| 7 — context compiler | Retrieval results can be too large or hard to verify in a model prompt | Deterministically budget selected evidence, reserve output capacity, include source citations and explain included/omitted items. Treat source text as untrusted. |
| 8 — evaluation | “It seems useful” does not measure retrieval quality | Versioned judged queries; report Recall@K, Precision@K, MRR, irrelevant-result rate, and latency with honest missing labels. |
| 9 — Atlas acceptance | A toy checkout cannot prove the actual integration works | Scan a verified Atlas revision, measure against reviewed source expectations, and report gaps without exposing secrets. |
| 10 — production agent/FDE integration | Hermes’s current stdio bridge is local, lexical, and not tenant-authorized | Add an authenticated application-owned context provider/API and thin SDK/MCP adapter only after storage, retrieval, compiler, and evaluation gates pass. |

For each phase, define the contract and failure/recovery experiment first, then implement backend behavior, tests, observability, and documentation, and only then expose it in the UI. The detailed acceptance plan is in [system architecture](../architecture/system.md), [API contract](../architecture/context-api.md), and [threat model](../security/threat-model.md).

## Quick troubleshooting

| Symptom | First checks |
| --- | --- |
| Web page cannot connect | `docker compose ps`; API `/health`; check the dev server is listening on 3000/4000 and `.env` uses the same browser hostname. |
| Chat history cannot load | API `/health/database`; confirm migrations are applied with `_platform_schema_migrations`; inspect API logs. |
| Model list empty/request times out | `curl http://127.0.0.1:8080/v1/models`; verify MLX is running, selected model matches a served ID, and local budget/timeouts are configured. |
| Redis health is red | Redis is optional for current chat/context work. Start the legacy profile only if you are exercising that dependency. |
| Hermes cannot find project tools | `hermes mcp test project-context`; verify the configured Python path and `CONTEXT_PROJECT_ROOT`; restart/reload MCP after config changes. |
| Hermes results look stale | Restart/reload the MCP process; it holds its scan snapshot for its lifetime. |
| Vector extension/table query fails | Run `npm run db:migrate -w @local-ai/api`, check `_platform_schema_migrations`, then inspect `\dx` and `\d+ embeddings`. Do not edit applied migrations. |

## Further reading

- [Local development setup](../infrastructure/local-development.md)
- [PostgreSQL model and migrations](../database/data-model.md)
- [Local MLX inference](../infrastructure/mlx-inference.md)
- [Hermes MCP integration](../integrations/hermes-mcp.md)
- [Engineering journal](../engineering-journal.md)
