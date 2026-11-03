# Phase 1 context-engine foundation

The NestJS and Python environments are independent. Install Node dependencies at the root with npm ci. Install uv 0.9.7 from its official package distribution, then run the commands below in apps/context-engine:

~~~sh
uv sync --frozen --python 3.12
uv run --frozen pytest -q
uv run --frozen ruff check app.py tests
~~~

For the host-run Nest API, copy the new CONTEXT_ENGINE_URL, CONTEXT_ENGINE_TOKEN and CONTEXT_ENGINE_TIMEOUT_MS entries from .env.example into local configuration. Use the same token for both services. The sample token is for loopback development only. Both runtimes reject that token in production. Generate a random token with at least 32 characters for deployment, distribute it through a secret manager and use a private trusted network/TLS. Token rotation currently requires coordinated configuration reload of both services; there is no key ring or automatic credential refresh.

From the repository root:

~~~sh
docker compose up -d postgres context-engine
npm run db:migrate -w @local-ai/api
npm run dev -w @local-ai/api
~~~

Redis and the web app remain optional for context foundation work. Existing conversation modules do not require eager database access at startup. FastAPI owns no database tables yet; its liveness indicates process availability, not retrieval or storage capability.

| Endpoint | Meaning |
| --- | --- |
| FastAPI GET /health on loopback port 8000 | Public local process liveness; used by Compose |
| FastAPI GET /internal/health | Requires Bearer service token; no project data |
| Nest GET /health/context-engine | Authenticated upstream probe, status 200, unavailable 503, deadline 504 |
| Nest GET /health/database | Real PostgreSQL readiness, independent of liveness |

The client uses a total deadline, does not retry, validates the response, and sends a request ID plus a valid traceparent when supplied. FastAPI validates or generates request IDs, preserves valid traceparent, and logs JSON status/duration/correlation without tokens, request bodies or private URLs. No project ID is fabricated for a process-health operation. Public health responses expose no service credential or raw upstream exception.

Health authentication demonstrates the service boundary only. No project/search/analyze/index APIs are exposed; identity, signed project authorization envelopes and database role/RLS enforcement must be implemented before shared context operations exist. The future signed permit binds tenant/project/user/environment/access labels, operation, request digest, policy version, audience and short expiry. This milestone does not claim that service authentication substitutes for tenant authorization.

## Repeatable isolated failure experiment

Run after uv sync and the API build, with Docker available:

~~~sh
npm run build -w @local-ai/api
python3 tests/foundation_failure.py
~~~

The script owns temporary API and FastAPI processes on free loopback ports and one explicitly named disposable PostgreSQL container. It never stops the existing Compose PostgreSQL/Redis services. Cleanup terminates its processes and removes its container. It verifies rejected missing credentials, successful authenticated calls, FastAPI stop/recovery, a real stalled HTTP server producing a bounded 504, PostgreSQL stop/recovery, process liveness during outages and pgvector availability.

Observed on 2026-11-03: all six experiment outcomes passed. An initial experiment failed because Docker reassigned its dynamically published port after restart; fixing the fixture to reserve a stable host port resolved that test error. The failure did not require an application recovery change.

Final Compose verification passed: container healthy, process UID 10001, authenticated internal health HTTP 200. Docker Desktop had stopped during an interruption; restarting it restored the container. The context-engine service is left running on 127.0.0.1:8000.

## Engineering notes

The Python ecosystem motivates this runtime boundary. A second service costs HTTP/configuration/credential/deadline management, which the foundation makes explicit. At load, health probes should have bounded concurrency and an operational polling interval; they are not a throughput benchmark or a retrieval SLO. No Redis-backed queue, repository scanner, embedding model or generative inference runtime is introduced here.

The Python tests passed with one upstream Starlette TestClient deprecation warning about httpx; it does not affect runtime Uvicorn requests. Python type checking and load tests have not been run. Interview challenge: why should API process liveness remain successful when either its database or its context engine is unavailable?

