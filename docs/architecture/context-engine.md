# Context engine and discovery

The Python core provides pure bounded analysis functions, adapters and scoped repositories. FastAPI wraps them with internal schemas, service authentication, limits and deadlines. The CLI invokes the same core locally with a versioned JSON protocol; no second analyzer is implemented in Node.

~~~mermaid
flowchart LR
    Root[Explicit approved local root] --> Walk[Bounded no-follow traversal]
    Walk --> Exclude[Path and file-type exclusions]
    Exclude --> Secret[Secret detection and sanitization]
    Secret --> Manifest[Versioned sanitized manifest]
    Manifest --> Discover[Project discovery and analysis]
    Discover --> Artifact[Graph and provenance artifact]
~~~

Discovery reads manifests/configuration as data, without importing modules, installing dependencies, running hooks/builds, evaluating JavaScript or sourcing .env files. Detect languages/frameworks/runtimes/package managers/workspaces/apps/packages/modules/dependencies/entry points/infrastructure/docs/API/schema artifacts with evidence. Report observed, inferred, unsupported and failed separately; an unsupported analyzer count is UNKNOWN, not zero.

Reject traversal outside root, symlinks in V1, special devices, sockets, archives, binary files and oversize files. Bound per-file bytes, total bytes, file count, depth, parse time, CPU and memory. Detect binary content by bounded inspection, not extension alone. Include ignored/failed counters and reason codes. A shared server must not accept arbitrary host paths; CLI uploads bounded sanitized artifacts, or the engine analyzes only server-configured read-only workspace mounts selected by an opaque source ID. Authentication does not make an arbitrary path safe.

~~~mermaid
flowchart TD
    Source[Sanitized source version] --> Parse[Language AST parser]
    Parse --> Symbols[Declarations imports exports decorators]
    Symbols --> Framework[NestJS GraphQL and schema adapters]
    Framework --> Facts[Normalized facts with source ranges]
    Facts --> Resolve[Bounded cross-file symbol resolution]
    Resolve --> Graph[Evidence-backed relationships]
    Parse --> Failure[Isolated parse failure with reason]
~~~

REST captures route/method/controller/DTO/parameters/security metadata; GraphQL captures operation/type/input/resolver facts; OpenAPI is parsed with external references disabled unless explicitly supplied locally and confined to root. PostgreSQL and MongoDB adapters analyze SQL migrations and repository schema definitions, not live production records or credentials. Recognize dynamic schemas as incomplete instead of executing them.

Semantic chunking follows class/function/interface/API/type/entity/document-section boundaries; long items are split with parent identity and line provenance. Secret removal precedes all persistence/chunking/embedding.

~~~mermaid
flowchart LR
    Manifest[New manifest and config versions] --> Compare[Compare versioned hashes]
    Compare --> Same[Unchanged reuse]
    Compare --> Changed[Added or changed analyze]
    Compare --> Removed[Removed tombstone]
    Changed --> Stage[Checkpoint staged graph chunks vectors]
    Same --> Stage
    Removed --> Stage
    Stage --> Validate[Validate completeness scope and references]
    Validate --> Publish[Atomically publish generation]
~~~

Changing analyzer/redaction/chunker/model settings invalidates the relevant cache even when file bytes are unchanged. Sanitize before hashing persisted text; a keyed raw digest may be used for change detection without retaining raw content. Secret-bearing paths/filenames also require redaction or exclusion.

