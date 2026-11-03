# Proposed API contract

No public or internal context routes are implemented through Phase 4. Keep the existing /api/v1 prefix for compatibility; do not add a parallel /v1 router merely to match illustrative URLs in the brief. Phase 4 exposes graph find/traversal only through the local CLI over a saved artifact; these proposed routes remain future work pending identity, authorization and filtering.

| Public NestJS route | Contract |
| --- | --- |
| POST /api/v1/projects | Authorized organization project registration |
| POST /api/v1/projects/:projectId/scans | Register sanitized bounded manifest/artifact; 202 run ID |
| GET /api/v1/projects/:projectId/scans/:scanId | Scoped status, counters, failures and checkpoint |
| POST /api/v1/projects/:projectId/context/index | Idempotent index request; 202 index ID |
| POST /api/v1/projects/:projectId/context/search | query, limit, environmentId, optional generation and allowed retrieval mode |
| POST /api/v1/projects/:projectId/context/compile | query or authorized result IDs, budget and requested sections |
| GET /api/v1/projects/:projectId/context/nodes/:nodeId | Scoped node and source references |
| GET /api/v1/projects/:projectId/context/nodes/:nodeId/graph | Bounded scoped graph traversal |
| GET /api/v1/projects/:projectId/sources | Cursor-paginated approved source metadata |
| GET /api/v1/projects/:projectId/security/findings | Separately authorized sanitized findings |

Tenant/user/roles/permissions are resolved from credentials and membership in Nest, not trusted from request JSON. Project path IDs are canonical UUIDs; slugs resolve within the caller's tenant. Environment permission is checked even when the requested project is allowed. Limit proposed search to 1–50 results, bounded query length and JSON bytes; final limits are tested in each implementation phase.

Internal FastAPI POST /internal/context/analyze, /index, /search and /compile use versioned Pydantic schemas. Add status/cancel APIs for persisted indexing work when storage is implemented. Public callers cannot reach internal routes; require service credential plus signed scope. No arbitrary URL/path/model download values accepted in ordinary requests.

Search example (shape, not observed data):
~~~json
{"query":"How does checkout work?","limit":10,"environmentId":"<environment UUID>","mode":"hybrid"}
~~~

Response: requestId, traceId, projectId, generationId, retrievalMode, measured durationMs, results. A result includes nodeId/chunkId, score and scoreKind, selection reasons, access-filtered relationships and SourceReference entries. Counts describe only authorized candidates; unknown metrics are null with a reason, never fabricated zeroes.

SourceReference requires sourceId, sourceVersionId, relative path, sanitized contentHash and optional verified inclusive line range. CompiledContext requires projectId, generationId, summary/sections/nodes/relationships/sources, estimatedTokens, estimator identifier and budget decisions.

Error envelope: error.code, safe message, retryable, requestId and traceId. Use 400 invalid input, 401 missing/invalid credential, non-enumerating 404 for inaccessible projects/resources, 403 for a known authorized resource with denied operation, 409 key/digest or generation conflict, 413 size limit, 422 unsupported processing input, 429 quota, 503 dependency unavailable, 504 deadline. Return no raw parser exception, credential, absolute path, rejected secret snippet or unauthorized source name.

Indexing uses Idempotency-Key scoped to tenant/project/environment and an input/config digest. Same key+digest returns the prior run; conflicting digest is 409. Correlation uses validated X-Request-ID and traceparent propagation. Server generates IDs when absent; correlation IDs do not grant authorization. Schemas must be contract-tested between TypeScript and Python; publish OpenAPI and generated clients only when routes exist.

