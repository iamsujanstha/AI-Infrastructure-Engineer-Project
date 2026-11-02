# Local Development

## Prerequisites

- Node.js 20.9 or newer and npm 10 or newer.
- Docker Engine with the Compose plugin.
- Ports `3000`, `4000`, `5432`, and `6379` available. PostgreSQL and Redis are published on loopback only.

Verification ran with Node.js 26.8.1, npm 11.19.0, and Docker 29.4.1 on macOS. MLX/Hermes is not part of the Phase 1 local stack.

## Start

From the repository root:

```sh
cp .env.example .env
npm install
docker compose up -d postgres redis
npm run dev
```

The web app is available at `http://localhost:3000`; the API is at `http://localhost:4000`. The root `.env` contains local-only sample credentials and is ignored by Git. Replace them for any non-local environment. `ConfigModule` loads the workspace `.env` and the root `.env`; shell environment variables take precedence.

Apply committed migrations to the configured database with:

```sh
npm run db:migrate -w @local-ai/api
```

Migration `0001` enables the PostgreSQL `vector` extension. Migrations `0002` and `0003` create the core data model and refine active-scope uniqueness. The runner applies checked-in SQL files in order, one transaction per migration, while holding a PostgreSQL advisory lock. It records SHA-256 checksums and rejects changed or missing applied migrations. It does not generate migrations or support nontransactional DDL such as `CREATE INDEX CONCURRENTLY` yet.

The Compose services have health checks, but the host-run API is not gated on them. Start dependencies first, or use `/health/database` and `/health/redis` to confirm readiness. The API process remains live while dependencies are unavailable, which helps distinguish process health from readiness.

## Health endpoints

| Endpoint | Meaning | Expected response |
| --- | --- | --- |
| `GET /health` | API process liveness only | `200` while the process can serve HTTP |
| `GET /health/database` | PostgreSQL `SELECT 1` | `200` ready, `503` unavailable |
| `GET /health/redis` | Redis `PING` | `200` ready, `503` unavailable |
| `GET /health/inference` | Configured inference health URL | `200` ready; `503` if unconfigured or unavailable |

The inference probe is expected to return `503` until `INFERENCE_HEALTH_URL` points to a trusted endpoint. Configure it only for a local/private service. The probe does not expose the URL or response body.

The Next.js control surface displays these checks. Its API base is compiled from `NEXT_PUBLIC_API_BASE_URL`; if that address changes, rebuild the web app.

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

`.env.example` documents supported settings. Configuration is parsed once at API startup; invalid values fail fast. The API and web development server bind to loopback by default. The checked-in Compose passwords are for loopback development only. Do not publish these ports, reuse credentials, or expose inference publicly. Phase 1 has no user authentication, authorization, TLS, backups, or production secrets integration.

The API limiter currently stores counters in process memory. It is useful for local behavior and a single process only; multiple replicas would each enforce separate budgets. Forwarded client IP headers are not trusted automatically. If deployed behind a proxy, configure trusted hops narrowly before relying on client IP rate limits.

## Data and reset behavior

PostgreSQL uses the `postgres_data` named volume and the pgvector PostgreSQL 17 image. Redis enables append-only persistence in the `redis_data` named volume. The initial checked-in migration enables pgvector; Phase 1 creates no domain tables. The existing local database was first bootstrapped with Prisma, so its `_prisma_migrations` metadata table is retained but unused; the raw-pg runner records history in `_platform_schema_migrations`. No migration history or application data is dropped. `docker compose down` keeps both volumes; `docker compose down -v` deletes them.
