# Local Development

## Prerequisites

- Node.js 20.9 or newer and npm 10 or newer.
- Optional local generation: Apple Silicon Mac, a Metal-capable macOS process, Python with MLX-LM installed, and a compatible cached or explicitly downloaded MLX model. See [local MLX inference](mlx-inference.md).
- Optional Hermes project-context tools: local Hermes Agent installation. The MCP adapter uses stdio and does not add a port.
- Docker Engine with the Compose plugin.
- Ports `3000`, `4000`, `5050`, `5432`, and `6379` available. PostgreSQL, pgAdmin, and Redis are published on loopback only.

Verification ran with Node.js 26.8.1, npm 11.19.0, and Docker 29.4.1 on macOS. MLX is optional and runs outside the Phase 1 context-engine stack. Hermes is an optional local agent integration; it does not power browser chat.

## Start

For the active context-platform Phase 1 setup, use [context-engine foundation](context-engine-foundation.md). It starts PostgreSQL and FastAPI; Redis is optional under the legacy Compose profile. The commands below retain the earlier web/conversation development setup.

From the repository root:

```sh
cp .env.example .env
npm install
docker compose up -d postgres redis pgadmin
npm run dev
```

The web app is available at `http://127.0.0.1:3000`; its formatted service directory is at `/services`. The API is at `http://127.0.0.1:4000`; pgAdmin is at `http://127.0.0.1:5050`. Open the interactive API references at `http://127.0.0.1:4000/docs` (NestJS) and `http://127.0.0.1:8000/docs` (FastAPI); raw OpenAPI JSON is at `/docs/openapi.json` for NestJS and `/openapi.json` for FastAPI. The NestJS service directory API at `/api/v1/system/services` lists local URLs and connection details with passwords omitted. The API allows both `127.0.0.1:3000` and `localhost:3000` as local browser origins. Use one hostname consistently when opening the app because browsers treat those origins as distinct. The root `.env` contains local-only sample credentials and is ignored by Git. Replace them for any non-local environment. `ConfigModule` loads the workspace `.env` and the root `.env`; shell environment variables take precedence.

Apply committed migrations to the configured database with:

```sh
npm run db:migrate -w @local-ai/api
```

Migration `0001` enables the PostgreSQL `vector` extension. Migrations `0002` and `0003` create the core data model and refine active-scope uniqueness. Migration `0004` adds conversation reply and generation-attempt lineage; `0005` enforces one streaming assistant response per conversation. The runner applies checked-in SQL files in order, one transaction per migration, while holding a PostgreSQL advisory lock. It records SHA-256 checksums and rejects changed or missing applied migrations. It does not generate migrations or support nontransactional DDL such as `CREATE INDEX CONCURRENTLY` yet.

The Compose services have health checks, but the host-run API is not gated on them. Start dependencies first, or use `/health/database` and `/health/redis` to confirm readiness. The API process remains live while dependencies are unavailable, which helps distinguish process health from readiness.

## Health endpoints

| Endpoint | Meaning | Expected response |
| --- | --- | --- |
| `GET /health` | API process liveness only | `200` while the process can serve HTTP |
| `GET /health/database` | PostgreSQL `SELECT 1` | `200` ready, `503` unavailable |
| `GET /health/redis` | Redis `PING` | `200` ready, `503` unavailable |
| `GET /health/inference` | Configured inference health URL | `200` ready; `503` if unconfigured or unavailable |
| `GET /docs` | NestJS Swagger UI | Interactive API reference, including Try it out |

The inference probe is expected to return `503` until `INFERENCE_HEALTH_URL` points to a trusted endpoint. Configure it only for a local/private service. The probe does not expose the URL or response body.

The FastAPI reference documents `/health` and bearer-protected `/internal/health`. NestJS documents its current chat and health routes. The chat UI is a loopback-only single-user prototype: Swagger Try it out for those routes works from the API's own local docs origin, but the origin check is not authentication and production mode rejects chat requests. Do not expose either docs UI or API beyond localhost without adding real authentication and authorization.

The home page provides local model chat; `/system` displays dependency checks. The NestJS service-directory endpoint returns configured service links but does not claim they are healthy. The chat connects automatically, restores saved conversations from PostgreSQL, and reads model choices from the configured inference provider. The API accepts chat requests only from configured browser origins and refuses them in production. This is a browser-origin restriction for a loopback single-user prototype, not authentication: another local process can call the API directly. Keep the API bound to loopback. The model receives bounded conversation history but no project retrieval. The web API base is compiled from `NEXT_PUBLIC_API_BASE_URL`; if that address changes, rebuild the web app. Hermes’ SQLite sessions and curated memory files are separate from PostgreSQL chat history.

## Useful commands

```sh
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
docker compose ps
docker compose logs postgres redis
docker compose down
```

`docker compose down` preserves named database volumes. To remove local database data as well, `docker compose down -v` is destructive and should only be used when that data is disposable.

`npm run test:integration` requires the local database to be running and migrations applied. It wraps its fixture writes in a transaction and rolls them back.

## Configuration and security limits

`.env.example` documents supported settings. Configuration is parsed once at API startup; invalid values fail fast. The API and web development server bind to loopback by default. `MLX_BASE_URL` must be HTTP loopback. The chat route refuses production mode, requires a loopback API bind, and checks the request's exact browser `Origin` against `CORS_ORIGINS`. Origin checks are not user authentication and do not stop local programs from calling the API. Do not publish these ports or expose inference publicly. Remote and multi-user use requires real identity and authorization.

The API limiter currently stores counters in process memory. It is useful for local behavior and a single process only; multiple replicas would each enforce separate budgets. Forwarded client IP headers are not trusted automatically. If deployed behind a proxy, configure trusted hops narrowly before relying on client IP rate limits.

## Data and reset behavior

PostgreSQL uses the `postgres_data` named volume and the pgvector PostgreSQL 17 image. Redis enables append-only persistence in the `redis_data` named volume. Migration `0001` enables pgvector, and migrations `0002`–`0005` create the existing core/conversation schema; the newer context-platform phases will add their own scoped schema incrementally. The existing local database was first bootstrapped with Prisma, so its `_prisma_migrations` metadata table is retained but unused; the raw-pg runner records history in `_platform_schema_migrations`. No migration history or application data is dropped. `docker compose down` keeps both volumes; `docker compose down -v` deletes them.
