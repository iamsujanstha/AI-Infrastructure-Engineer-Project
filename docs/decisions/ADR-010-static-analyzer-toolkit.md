# ADR-010: version-locked static analyzer toolkit

- **Status:** Accepted for local Phase 3 analysis, 2026-11-03
- **Context:** Phase 2 supplied safe, bounded, secret-screened file bytes but no syntax/API/schema facts. Phase 3 requires useful TypeScript/NestJS/GraphQL support and must never execute repository code or trigger hidden network fetches.
- **Constraints:** Preserve the shared Python core; use deterministic local artifacts; retain source ranges and content hashes; fail only the malformed source; bound inputs and output facts; do not resolve external references or execute project config.

## Decision

Use the upstream `tree-sitter` Python binding with separately version-constrained grammar wheels for Python, JavaScript, TypeScript/TSX, GraphQL, PostgreSQL, JSON and YAML. Pin Tree-sitter core below 0.26: AST traversal on a checked-in TypeScript repository file crashed with 0.26.0 and passed with 0.25.2. Use the PostgreSQL-specific grammar for migration DDL rather than a generic SQL grammar. Resolve exact versions through `uv.lock`. Use Python's `tomllib` for TOML and PyYAML `SafeLoader` with aliases, duplicates, nesting and node-count checks for OpenAPI YAML. JSON values use the standard library only after Tree-sitter validates syntax and derives key line positions. All parsing receives bytes already screened by the Phase 2 file reader.

The Tree-sitter bindings expose local grammar objects from installed wheels; the scanner does not invoke the language-pack API that automatically downloads missing grammars. [Tree-sitter's Python binding installation guidance](https://pypi.org/project/tree-sitter/) describes installing the parser and a separate language grammar package. The [PostgreSQL grammar package](https://pypi.org/project/tree-sitter-postgres/) is generated from PostgreSQL's grammar and lists BSD-3-Clause licensing. Language-specific extractors use literal syntax only and attach adapter/evidence labels to framework-derived API facts.

## Alternatives

- Regex-only extraction: fewer packages but comments, strings and nested syntax produce false declarations and unreliable ranges.
- Runtime imports, package install, build or framework bootstrap: richer semantic discovery but executes untrusted code and may access networks or credentials.
- A dynamic grammar bundle fetched on demand: smaller initial dependency set but mutable first-use network behavior harms reproducibility and breaks the no-egress scan boundary.
- Implement only Python `ast`: no native extension grammars but misses the target NestJS/TypeScript and GraphQL structures.

## Consequences and tradeoffs

Artifacts gain declarations, imports, exports, decorators, static REST/GraphQL operations, OpenAPI shapes, SQL tables/columns, document headings and dependency declarations. Static facts are not runtime behavior. Dynamic paths, alias resolution, cross-file binding, API reachability, external `$ref`, ORM-generated schemas, Mongo models and semantic code explanations remain unsupported. Each supported grammar adds a native package and platform-wheel maintenance to the locked Python environment.

Malformed/unsupported files are isolated and make analyzer coverage partial. The scanner caps source size, YAML structure, per-file facts and project facts. Parsing occurs in a spawned process with a 2-second per-file deadline and worker recycling after 12 files; this contains hangs and native crashes. It does not impose an OS memory quota, so hard memory isolation and tenant controls are required before shared multi-tenant ingestion. Parser native-code vulnerabilities remain part of the local process trust boundary.

## Scaling, security and observability

The current sequential CLI is appropriate for bounded local inspection and uses a single isolated worker. At 10x corpus size, parsing should move to a bounded worker pool with OS memory/cancellation policy before raising limits. Do not add a queue or database until Phase 4/5 requires graph processing or durable indexing. Output paths, routes, symbols and dependency names can be sensitive. Secret screening precedes parser input, and analyzer errors do not include raw snippets.

## Acceptance evidence and interview prompt

Tests exercise NestJS/Express/FastAPI routes, Python/TypeScript symbols, GraphQL definitions/resolver methods, OpenAPI JSON/YAML, PostgreSQL DDL, dependencies, docs, exact line ranges, malformed sibling isolation, YAML aliases/duplicate keys, duplicate JSON keys and non-execution. Real local migration and repository source files passed a worker probe after pinning Tree-sitter 0.25.2. No parser quality benchmark against Atlas or representative language corpus has been run.

**Interview question:** What extra evidence would you need to turn a static `@Get(':id')` fact into a reachable, authorized API contract with a resolved path and DTO schema?
