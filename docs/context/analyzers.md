# Phase 3: static project analyzers

The local `context scan` pipeline reads each eligible file once through the Phase 2 no-follow scanner, applies the secret detector, then parses the same in-memory bytes. Analyzer output contains normalized facts and source metadata only. The Phase 6 scanner artifact separately contains bounded source chunks for eligible files to support local retrieval; see the [scanner guide](project-scanner.md) for privacy and size limits. Every fact includes the stable `source_id`, screened-content SHA-256, relative path, and validated inclusive 1-based line range. Analyzer facts use schema version 1; the current containing scan artifact uses schema version 4.

## Implemented adapters

| Input | Facts emitted | Evidence and boundary |
| --- | --- | --- |
| Python, JavaScript, TypeScript, TSX | Classes, functions/methods, imports, exports, decorators | Tree-sitter syntax only; no imports are executed and no cross-file symbol resolution is claimed |
| NestJS | Literal `@Controller` + HTTP method decorators, module declarations | Requires an import from `@nestjs/common`; dynamic route expressions and imported aliases are not resolved |
| Express/Fastify | HTTP method calls with a literal first route argument | Requires an `express` or `fastify` import in that file; call ownership/instance types are not resolved |
| FastAPI/Flask | Static Python route decorators | Requires the matching framework import; dynamic paths and application construction are not evaluated |
| GraphQL SDL | Types, interfaces, inputs, enums, unions, scalars, fields and Query/Mutation/Subscription fields | Syntax facts, not resolver/runtime reachability |
| Nest GraphQL | `@Query`, `@Mutation`, and `@Subscription` method declarations | Requires an `@nestjs/graphql` import; inferred operation name is the method name |
| OpenAPI JSON/YAML | HTTP operations and component schema names | Validates a local document shape; duplicate JSON/YAML keys and YAML aliases fail the document; `$ref` values are never fetched or resolved |
| PostgreSQL SQL | `CREATE TABLE` and column declarations | PostgreSQL grammar facts from local SQL files; no live database or migration execution |
| Markdown/reStructuredText | Markdown headings outside fenced code and reStructuredText underlined headings | Section titles and line ranges only; no prose chunking yet |
| `package.json`, `pyproject.toml`, `requirements*.txt` | Declared dependency names and safe version specifiers | Lockfile bodies remain unopened; URLs, executable install steps and dependencies are never followed |

Analyzer failures are per file. A malformed source or schema produces a sanitized reason code, suppresses that file's facts, and leaves valid sibling facts available. Unknown extensions are counted as unsupported; any unsupported or failed file makes the analyzer and scan status `partial`. Do not interpret `partial` as a failed process or `complete` as proof that every possible language was semantically understood. Counts are observed fact counts, not runtime endpoint/entity counts.

## Parsing and resource boundaries

Tree-sitter core and the Python, JavaScript, TypeScript, GraphQL, PostgreSQL, JSON and YAML grammar wheels are version constrained and committed in `uv.lock`. Core is held at 0.25 because traversal with 0.26 reproducibly crashed on a real TypeScript repository file; the worker now isolates native parser failures, and the pinned version passed that same file. The scan does not download grammars or access a project network. PyYAML uses `SafeLoader`; aliases, duplicate keys, excessive nesting and more than 100,000 YAML nodes are rejected. JSON duplicate keys are rejected for dependency/OpenAPI line mapping. Parser exceptions and snippets are not serialized.

The scanner still caps each accepted file at 1 MiB, total accepted reads at 50 MiB, entries at 20,000, depth at 24 and traversal time at 30 seconds. Analysis caps each file at 5,000 facts and each project at 50,000 facts; exceeding the project fact limit stops traversal and marks the result partial. Tree-sitter walks are iterative, and fact generation is capped. Native parsing runs in a spawned worker, recycled after 12 files and terminated after a 2-second per-file deadline. This contains a native crash or hung parse and records a per-file failure, but it does not impose an OS memory quota. The current local CLI runs under the invoking user's OS identity; shared server ingestion still requires worker memory isolation, cancellation, and tenant admission controls.

Only syntax-proven facts are emitted. No call graph, dynamic route, decorator alias, schema reference, macro expansion, ORM runtime model, Mongo schema, or cross-file binding resolution is claimed. These need distinct adapters and evidence. Phase 4 turns facts into a local graph; they are not persisted, indexed, authorized for shared retrieval, or exposed by API routes.

## Failure experiment

`tests/test_analyzers.py` covers valid/invalid sibling isolation, syntax ranges and content hashes, YAML aliases/duplicate keys, duplicate JSON keys, unsupported formats, external OpenAPI reference non-resolution, PostgreSQL DDL including qualified table names, fact caps, and source text that would create a marker file if executed. A deterministic worker test forces a per-file deadline, verifies a timeout result, then verifies a subsequent file succeeds through a fresh worker. The marker remains absent. A worker probe also analyzed the repository's `0002_core_data_model.sql` migration and `conversation.repository.ts` without a crash. Recovery is to repair the specific source or accept the explicit unsupported/partial result and rerun; no prior artifact is overwritten.

## Learning record

- **Problem:** Convert discovered files into inspectable source facts without executing untrusted project code.
- **Internal behavior:** Secret-screened bytes are parsed by version-locked grammar adapters and normalized into source-ranged facts. Dependency and OpenAPI JSON use syntax-derived line maps; YAML preserves key line marks while constructing only safe data values.
- **Failure and recovery:** Syntax, manifest, duplicate-key, alias, resource and unsupported-language cases become per-file errors or partial coverage. Native crashes and parses exceeding the worker deadline are also isolated to one file. Valid siblings continue. Correct the input or rerun after a parser/limit adjustment.
- **Load/bottleneck:** Tree-sitter parsing and fact extraction scale with accepted source bytes and AST node counts. Per-file/project fact caps bound artifact growth; the 2-second worker deadline bounds parse wall time, while the worker has no OS memory quota. I/O and secret inspection still run first. No load benchmark is claimed.
- **Alternatives/tradeoffs:** Regex-only analysis would be easier but confuses comments and syntax with declarations. Runtime imports/builds would discover more behavior but execute untrusted code. Version-locked grammar wheels avoid mutable first-use network downloads at the cost of more dependencies and explicit language coverage.
- **At 10x scale:** A local sequential CLI remains the first bottleneck. A server needs isolated worker identities, hard memory quotas, cancellation, bounded parallelism, incremental syntax trees, and per-tenant admission before accepting repositories.
- **Security/observability:** The detector remains heuristic; facts can contain internal symbol names, paths, routes and dependency names. The local output is sensitive. Parser timings are measured, never presented as inference latency. No raw text, parser error strings or external reference content is emitted.
- **Interview question:** Why can a syntax tree prove that a route decorator exists while still being insufficient to claim that the route is reachable or that its dynamic path is known?

## Verification record

Phase 3 checks and actual platform self-scan results are recorded in the [engineering journal](../engineering-journal.md). Atlas Commerce has not been scanned; this repository is only a parser fixture/source-coverage check.
