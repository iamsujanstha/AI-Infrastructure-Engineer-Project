# Local platform guide

Use this document to operate the company PDF assistant. Use [project-context operations](../context/storage-operations.md) for scanning code/Hermes, [architecture](../architecture/system.md) for contracts and permissions, and [interview notes](../interview/README.md) for deeper reasoning. Commands below are procedures, not evidence they ran during documentation cleanup.

<a id="pdf-policy-workspace"></a>
## PDF policy workspace

The homepage and `/cms` support authenticated local accounts. The first operator creates the organization/admin; no default password or real company account was seeded. Keep the pilot local and use synthetic data until deployment and company acceptance are reviewed.

1. Create employees with deliberate roles after first-admin setup.
2. Upload a **Company policy** PDF and choose its audience. The filename supplies the title; no manual context/chunk/embedding fields are needed.
3. For a personal PDF, select **One employee · salary only** or **One employee · leave record**, then its employee owner. These are permission settings, not retyped content. Split bulk/mixed files first; never classify a personal record as an all-employee policy.
4. Ask using **Uploaded PDFs**. Inspect original quotations, owner/category, PDF page and extracted-line references. No evidence produces not-found; a failed dependency remains an error.
5. Archive superseded documents explicitly. Uploading changed bytes does not automatically retire the old policy or establish which version applies.

PDF facts are dated snapshots. “Ten days remaining on 1 October” does not establish today's remaining leave. The optional structured salary/leave workflows use separate authoritative tables and transactions. Upload does not update those records or approve leave. The employee selector controls structured record lookups, not the current all-permitted-document PDF search; HR must verify citation ownership.

The [role matrix](../architecture/system.md#authorization) applies before listing, lexical/vector selection and cached-source reload. An incorrectly classified PDF can still leak data to its chosen audience: extraction cannot reliably infer employee ownership or separate mixed personal facts.

## Start the local system

### Prerequisites and network choice

Use the Node version required by root `package.json`, npm workspaces, Docker/Compose and Python 3.12 with the checked-in `uv.lock`. Current context-engine packaging pins uv 0.13.7. MLX requires a compatible Apple Silicon macOS environment and a cached/explicitly prepared model; it stays outside the Linux computation container.

Use one hostname consistently: `127.0.0.1` and `localhost` are different origins. Defaults are web 3000, API 4000, context engine 8000, MLX 8080, PostgreSQL 5432, pgAdmin 5050 and optional Redis 6379. Change configured ports deliberately if occupied; do not stop unrelated applications.

Compose requires the existing external network named by `DOCKER_SHARED_NETWORK`. The example name is a placeholder. Inspect your actual network and choose either this project's optional dependencies or your existing shared services, avoiding duplicate `postgres`/`redis` aliases. Published loopback ports do not isolate container peers on the shared network.

### Host web/API, containerized PDF computation

For a **new installation only**:

```sh
cp .env.example .env
npm ci
```

For an existing installation, preserve `.env` and add only missing settings from the example. Keep credentials uncommitted. Set `DOCKER_SHARED_NETWORK` to the chosen network. Host `DATABASE_URL` uses the host-published database address; container `DOCKER_DATABASE_URL` uses Docker DNS. Ensure `CONTEXT_ENGINE_TOKEN` for the host API equals the container's `DOCKER_CONTEXT_ENGINE_TOKEN`; both must be configured consistently. The service token is not an employee credential.

When using this project's own database, start only the explicitly selected local dependencies:

```sh
docker compose --profile local-infra up -d postgres pgadmin
docker compose build context-engine
docker compose run --rm --no-deps context-engine python policy_compute.py --download-model
docker compose up -d context-engine
```

The model-preparation command explicitly downloads public embedding weights into the dedicated volume. It sends no PDFs/questions. Ordinary computation is local-only and fails when weights are missing; it does not download on demand. Do not repeat downloads to fix a database or authorization failure.

Before migrating an existing database, confirm the target and take a protected backup. Then:

```sh
npm run db:migrate -w @local-ai/api
npm run dev
```

In a separate compatible macOS MLX environment, with the chosen model already cached:

```sh
HF_HUB_OFFLINE=1 mlx_lm.server --model mlx-community/Qwen3-8B-4bit
```

Open `http://127.0.0.1:3000`. UI/model discovery failure means a real dependency/configuration problem, not a request for a browser API token. Local account login still requires your own CMS credentials.

This Mac previously rejected the required native PDF worker memory cap. Use the Linux context-engine container for PDF uploads; there is no unbounded host fallback. The project scanner can still use its host Python environment independently.

### Containerized web/API on shared infrastructure

Use this variant when container packaging is needed, not in addition to duplicate host API/web processes:

```sh
cp .env.docker.example .env.docker
# Edit the new file for your existing network, service DNS and private credentials.
docker compose --env-file .env.docker build
# Confirm target/backup first. This one-off command does not start the API server.
docker compose --env-file .env.docker run --rm --no-deps api node dist/database/migrate.js
docker compose --env-file .env.docker run --rm --no-deps context-engine python policy_compute.py --download-model
docker compose --env-file .env.docker up -d
```

Preserve an existing `.env.docker`. Default app containers reuse existing database/Redis infrastructure; only opt into `local-infra` when needed. Add optional OIDC/cache/routing settings to the chosen environment file; the example is not proof they are configured.

The API uses `0.0.0.0` **inside** its development container and an explicit `LOCAL_CHAT_CONTAINER_MODE` opt-in. The host port stays loopback-published; peers can still reach the API. MLX gateway mode permits the configured `host.docker.internal` development destination, but requires a host-reachable listener and expands its trust boundary. Prefer the host API variant if you cannot restrict that inference listener to trusted traffic. Do not expose MLX publicly to make Docker convenient.

`NEXT_PUBLIC_API_BASE_URL` is compiled into the browser build; changing it requires rebuilding the web image. Never put server-side secrets in `NEXT_PUBLIC_*` variables.

<a id="google-workspace-sign-in"></a>
## Google Workspace sign-in

**Implemented adapter; live organization login not yet configured/accepted.** Local password login remains available. A Workspace administrator must register the correct web client, audience and exact callback. Set values only in the ignored local configuration/secret store:

```dotenv
OIDC_ISSUER=https://accounts.google.com
OIDC_ALLOWED_HOSTS=accounts.google.com,oauth2.googleapis.com,www.googleapis.com
OIDC_GOOGLE_WORKSPACE_DOMAIN=your-verified-company-domain.example
OIDC_CLIENT_ID=your-registered-web-client-id
OIDC_CLIENT_SECRET=your-private-client-secret
OIDC_REDIRECT_URI=http://127.0.0.1:4000/api/v1/cms/oidc/callback
OIDC_WEB_ORIGIN=http://127.0.0.1:3000
```

These are placeholders, not working credentials. Restart API after configuration; ensure callback hostname matches web hostname and web Origin is allowed. Configuration validates this at startup. Never paste client secrets, auth codes or identity tokens into chat/logs.

Provision each local account, then bind its verified `(issuer, sub)` through the admin identity control. Obtain the subject through organization-controlled provisioning or an independently validated identity process; do not trust an arbitrary subject provided by the person seeking access. There is no email auto-linking. Google's signed `hd` must match the configured domain; an account-choice hint/email suffix does not establish membership. Roles continue to come from current local account records. See the [protocol reference](https://developers.google.com/identity/openid-connect/openid-connect) and [claim meanings](https://developers.google.com/identity/openid-connect/reference).

Login grants no Google Drive access and imports no company documents. Live acceptance must check a bound employee, unbound/wrong-domain account, expired/reused state and revoked local role. Protocol tests using signed synthetic tokens do not replace that organization test.

## Configuration choices and limits

| Setting / boundary | Use and reason | Drawback / caution |
| --- | --- | --- |
| `LEGACY_LOCAL_CHAT_ENABLED=false` | Keeps historical fixed-owner chat outside the CMS | Enabling it restores a non-isolated local development path; not a company feature |
| `PEOPLE_DB_TIMEOUT_MS=5000` | Bounds CMS query/transaction waits | A timeout is not proof no commit occurred; reconcile state before retrying writes |
| `POLICY_COMPUTE_TIMEOUT_MS=60000` | Bounds waiting for extraction/embeddings | Does not guarantee all downstream work stops at disconnect |
| `POLICY_SEMANTIC_CACHE_ENABLED=false` | Prefer auditable exact policy reuse until corpus evaluation | Lower hit rate; similarity/fingerprint reuse can still confuse meaning if enabled |
| `POLICY_SMALL_MODEL`, `POLICY_LARGE_MODEL` | Route only to IDs reported by the provider | Configuration alone loads no model; switching/resident memory may remove any gain |
| `MLX_CONTEXT_WINDOW_TOKENS`, `MLX_MAX_OUTPUT_TOKENS` | Explicit input/output budget | Current byte/template estimate is not exact tokenizer accounting |
| Qwen3 thinking disabled by default | Spend bounded evidence-selection output on the selection | This is task-specific; re-evaluate quality before using the choice for harder tasks |

PDF upload caps: 5 MiB / 100 pages / 160k extracted characters / 200 passages. Scanned/image-only and encrypted files require conversion; OCR is not implemented. Text extraction can lose table order or separate a rule from its exception. Page references are useful; extracted line numbers are not coordinates in the visual PDF.

The English BGE embedding profile includes model/tokenizer hashes and FastEmbed version. A new profile needs reindexing; same dimension does not mean compatible vectors. Test Nepali/Hindi material before promising multilingual retrieval.

## Inspect real signals

```sh
docker compose ps
curl -i http://127.0.0.1:4000/health
curl -i http://127.0.0.1:4000/health/database
curl -i http://127.0.0.1:4000/health/context-engine
curl -i http://127.0.0.1:8000/health
curl -i http://127.0.0.1:8080/v1/models
```

Liveness means a process can answer; readiness checks a particular dependency. FastAPI liveness can be healthy while its embedding cache is missing. `/health/inference` requires its optional health URL configuration; an unconfigured probe is not proof MLX itself is broken. `/health/redis` can fail while the PDF flow works because Redis is optional.

The `/services` catalog lists configured addresses, not health. `/system` shows actual dependency checks. Nest docs are `/docs` (JSON `/docs/openapi.json`); FastAPI docs are `/docs` (JSON `/openapi.json`). Protected CMS operations still require login/Origin; Swagger does not bypass policy.

Admins can load `/cms/rag/metrics` through the UI. Runs include upload and answer operations, real outcomes, model/profile, cache kind, source count and measured durations. Retrieval includes pre-inference preparation; inference is null for cache hits. Total is measured before some final persistence/delivery and is not full browser latency. No runs means median UNKNOWN, not a fabricated zero. These are not actual token bills, TTFT or complete trace spans.

For PostgreSQL, use the configured host address with a desktop client; pgAdmin on the shared network uses the service's DNS name. Credentials stay in your local configuration. Prefer metadata queries over dumping private content:

```sql
SELECT migration_name, applied_at
FROM _platform_schema_migrations ORDER BY migration_name;

SELECT operation, outcome, cache_kind, source_count,
       retrieval_ms, inference_ms, total_ms, created_at
FROM people_cms.policy_runs
WHERE organization_id = 'YOUR_ORGANIZATION_UUID'
ORDER BY created_at DESC LIMIT 20;

SELECT id, record_kind, audience, employee_id, active, embedding_profile
FROM people_cms.documents
WHERE organization_id = 'YOUR_ORGANIZATION_UUID'
ORDER BY created_at DESC LIMIT 20;
```

Replace placeholder UUIDs locally. Database-owner queries bypass the application's employee restrictions; do not hand pgAdmin access to normal employees as a substitute for the CMS. [Migration runner](../../apps/api/src/database/migration-runner.ts) owns ordered/checksummed transactional DDL. It does not support `CREATE INDEX CONCURRENTLY` inside its current per-file transaction mode; design a separate mode before using such DDL.

## Failure and recovery exercises

These are procedures for isolated synthetic infrastructure; do not stop the main company/shared service. Each exercise has a narrow claim.

| Exercise | Predict / act | Evidence / recovery | Does not prove |
| --- | --- | --- | --- |
| Cross-employee access | Upload personal owner A file; ask as B, HR and accountant | No B source/name exposure; HR allowed; accountant salary allowed, leave denied; archive fixture | Every future policy or classification is correct |
| Unsupported question | Ask an unrelated question against fixed PDFs | Not-found instead of world-knowledge answer; restore question set | Perfect relevance/abstention on all language |
| Compute timeout | Test API with 1,000 ms deadline; pause only its disposable compute container | Safe bounded 503, no answer; unpause in cleanup and recheck upload/question | Production failover, full cancellation or load capacity |
| Archive/revocation | Cache an allowed policy answer; archive document or revoke test account | No reuse of withdrawn source; restore only synthetic permissions if needed | Physical erasure or recall of already delivered data |
| Malformed/scan-only PDF | Upload synthetic broken/encrypted/image-only fixture | Rejection/no publication; use corrected text PDF | Malware immunity or table fidelity |
| Budget/overload | Exceed fixed test context or contend for compute | Explicit error/busy rather than unlimited work; restore limits/workload | A measured production SLO |

Recorded previous implementation checks: isolated compute pause returned 503 after 1,058 ms; after unpause browser upload indexed a PDF. Real synthetic salary PDF was accessible to its owner/HR/accountant and denied to another user. Current runtime health was not rechecked while consolidating these notes. Full dated evidence and limitations are in the [journal](../engineering-journal.md).

Verification commands for an approved implementation phase:

```sh
npm run lint
npm run typecheck
npm run build
# This integration suite deliberately resets only the named disposable database.
PEOPLE_TEST_DATABASE_URL=postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:TEST_PORT/cms_test_local npm test
cd apps/context-engine
uv sync --frozen --python 3.12
RUN_POLICY_EMBEDDING_TEST=1 .venv/bin/python -m pytest -q
.venv/bin/python evaluate_policy_embeddings.py
```

Never point the CMS fixture suite at development/company data. It enforces a loopback `cms_test_*` target but you still choose the database. The embedding test needs prepared local model files. The evaluation script reads the checked-in [synthetic fixture](../evaluation/policy-embedding-fixtures.json); it is a component comparison, not company acceptance. Read [evaluation reasoning](../interview/README.md#evaluation) before interpreting scores. The separate `tests/foundation_failure.py` owns its own temporary processes/container; inspect its setup and safety bounds before execution.

## Troubleshooting and data lifecycle

| Symptom | First useful check | Recovery / limit |
| --- | --- | --- |
| Browser cannot reach API | Hostname, build-time API URL, Origin, port and real API liveness | Correct exact config/restart owning process; do not broaden CORS to `*` |
| Upload 403 | Current session/admin role and local-mode guard | Sign in to permitted account; file text cannot grant admin |
| Upload 422 | Text extractability, encryption/active content, size/pages, credential pattern | Convert/review file; never remove privacy checks just to accept it |
| Upload/answer 503 | Compute container/cache, MLX, DB readiness and bounded timeout | Restore correct dependency; no cloud fallback |
| 429 busy | One active PDF/embedding computation and HTTP limits | Retry after work drains; investigate workload before increasing parallelism |
| Valid citation, wrong answer | Owner/date/category, source wording, candidate coverage and selector | Correct document/classification; improve judged retrieval before adding a larger model |
| Old policy still appears | Superseded document still active or ambiguous applicability | Archive intentionally; do not assume latest filename wins |
| Google button absent | OIDC issuer/client configuration | Configure registered provider; do not invent credentials |

Original PDF bytes are not retained by this feature. Extracted text, vectors, query-derived cache vectors/hashes, browser/inference memory, audit metadata and backups still have privacy implications. Archive excludes future document use and advances policy revision; it is not physical deletion. Expired cache cleanup happens on writes, not an independent retention scheduler. Define access, encryption, deletion coverage and backup expiration before real company use.

Normal container shutdown preserves named volumes. Removing volumes is destructive and is not a routine recovery step. A validated backup listing proves archive readability, not a successful restore: rehearse restore into a separate database and verify schema/data before trusting recovery.

Legacy general chat has separate stored transcripts; pasted-reference mode is request-only. Both are developer-only, disabled by default, and do not acquire CMS identity simply by enabling a flag. Hermes session history and curated memory are separate again.
