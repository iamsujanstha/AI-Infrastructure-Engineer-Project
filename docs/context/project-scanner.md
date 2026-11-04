# Phase 2: local project discovery

## Commands

From the platform checkout, install Node workspaces, synchronize Python, and build the thin CLI:

~~~sh
npm ci
cd apps/context-engine
uv sync --frozen --python 3.12
cd ../..
npm run build -w @local-ai/context-cli
npm run context -- init --root /absolute/path/to/project --name atlas-commerce
npm run context -- scan --root /absolute/path/to/project
~~~

After workspace installation and build, node_modules/.bin/context is also available. The CLI is private/local for this phase, not a published SDK or standalone installer. It invokes the platform's shared Python scanner through an argument array without a shell. CONTEXT_ENGINE_PYTHON optionally selects a trusted operator-installed interpreter; project configuration cannot override it. Scanning does not require a FastAPI server, database, credentials or network access.

Init creates .context-platform.json exclusively with mode 0600: schema version, local project UUID, supplied display name and optional exclude_names list. It refuses to overwrite existing configuration. A local UUID provides source identity, not platform authorization. Preserve the config to keep source IDs stable; it contains no credentials.

Scan prints a JSON summary with analyzer and graph coverage/counts. To save the full provenance, graph, exclusion and finding artifact:

~~~sh
mkdir -p /absolute/path/to/project/.context-platform
npm run context -- scan --root /absolute/path/to/project --output /absolute/path/to/project/.context-platform/scan.json
~~~

The saved schema-version-4 scan artifact contains static facts, the Phase 4 graph, and bounded text chunks from eligible files that passed the whole-file secret screen. The artifact therefore contains project source excerpts and must be kept private. Query graph metadata locally with exact selectors and bounded adjacency:

~~~sh
npm run context -- graph find --artifact /absolute/path/to/project/.context-platform/scan.json --type dependency --name fastify
npm run context -- graph traverse --artifact /absolute/path/to/project/.context-platform/scan.json --node-id <node-uuid> --depth 2 --limit 100
~~~

Graph query limits and provenance behavior are described in the [context graph guide](../architecture/context-graph.md).

Output must not exist; it is created exclusively with mode 0600. Parent directories must already exist. The operator selects the output location; output parents are trusted local filesystem paths. Protect manifests because architecture/path/finding metadata can be sensitive. Exit codes: 0 complete, 1 initialization/configuration/output/root error, 2 partial scan caused by failure or limits. Secret exclusions can occur in a complete discovery scan; complete does not mean every source was indexed or absence of secrets.

## Actual discovery and provenance

The shared scanner detects accepted-source language counts, Node/Python runtime evidence, known dependency framework/build-tool declarations, lockfile package-manager evidence, package manifests/workspace patterns, conventional entrypoint candidates, configuration files, infrastructure files, documentation and API/database schema candidates. It reads JSON/TOML as data. It never runs scripts, imports repository modules, installs their dependencies, sources environment files or connects to customer databases.

Framework evidence is a dependency declaration, not proof a service is running. Conventional entrypoint/schema candidates remain candidates; analyzer facts are separate and carry static evidence labels and line ranges. See [Phase 3 analyzer coverage](analyzers.md). The legacy summary module/API/entity counters remain null (UNKNOWN) where the scanner cannot establish complete coverage; use analyzer fact kinds for observed syntax facts, not as runtime counts.

Accepted files retain project_id, stable project+path UUID, relative path, SHA-256 hash, bytes and verified 1-based line range. For Phase 6 retrieval, text from files that pass whole-file secret screening is split into overlapping, line-provenanced chunks (4,000 characters maximum, 300-character overlap). The scan artifact contains these chunk bodies, capped at 20,000 chunks and 16 MiB total chunk content; crossing a cap marks the scan partial. These files are not redacted; a file with a detected credential or high-entropy pattern is excluded as a whole. Heuristics cannot prove that arbitrary source text contains no sensitive information, so protect scan artifacts and local PostgreSQL as private source data. Phase 3 analyzes the screened in-memory bytes from the same descriptor read and binds facts/chunks to the source hash. No absolute root path or raw parser exception appears in output. Source IDs change when paths or the local project UUID change; rename tracking is future work.

## Security and bounds

Reads use directory descriptors, O_NOFOLLOW and regular-file checks; directory traversal is bounded and symlinks are rejected. Credential files/directories, .env variants (including examples), private keys/certificates, dependencies/build output, VCS internals and scanner artifacts are excluded. Archives are not unpacked. Lockfiles contribute package-manager evidence only. Additional exact basename exclusions can be configured through exclude_names; this phase does not interpret .gitignore or execute ignore configuration.

Eligible UTF-8 text passes credential-assignment/known-format/private-key/credential-URL patterns plus high-entropy detection before discovery or hashing. Any finding excludes the entire file rather than attempting uncertain inline redaction. Findings contain only rule, safe relative path and line, never matching values. Unsafe or potentially credential-bearing paths are suppressed. ASCII-safe relative paths are the current supported path subset; other paths are excluded explicitly. Plain documentation/source remains untrusted data and no instructions are interpreted.

Default limits: 1 MiB per eligible file, 50 MiB accepted reads, 20,000 observed entries, depth 24 and 30 seconds traversal time. Limits can be lowered via the Python Limits contract and have hard upper validation bounds. The elapsed-time check is cooperative between directory entries, not a hard timeout for a stalled filesystem syscall. Concurrently changed files are rejected using before/after stat checks. Scanning a live working tree is not an atomic Git snapshot; use a fixed checkout for reproducibility. Large excluded directories count as one exclusion, not invented descendant totals. Secret counts are rule matches, not unique confirmed credentials. Entropy/pattern checks can miss unfamiliar secrets and can exclude benign hashes/fixtures; never claim a clean scan guarantees no secrets.

The scanner artifact uses schema version 4 and embeds graph schema version 1. At scale, filesystem I/O, secret matching, parsing, chunk generation, fact generation and graph materialization dominate. File/entry/byte/depth/traversal limits, fact caps and chunk caps produce partial results rather than unbounded artifacts. Parsing runs in a spawned worker with a 2-second per-file deadline and recycling after 12 files, but no OS memory quota is applied. Do not accept shared multi-tenant repository input until worker memory isolation, cancellation and tenant admission are implemented. Chunking supplies source evidence for local lexical retrieval; semantic embeddings, shared authorization and context compilation remain future work.

## Verification and failure experiment

~~~sh
cd apps/context-engine
uv run --frozen pytest -q
uv run --frozen ruff check scanner.py local_cli.py tests/test_scanner.py
~~~

The scanner tests build disposable directories containing secret canaries, malformed manifests, missing roots, symlink escapes, binary/oversized files, FIFOs and entry limits. They assert safe exclusions/failures, no secret values in serialized output, stable provenance, init refusal to overwrite and artifact refusal to overwrite. Recover by fixing the source/config/root or selecting a fresh output path and rerunning; no previous accepted artifact is overwritten.

Observed 2026-11-03 on the actual platform checkout before this guide was added: the built Node CLI observed 152 entries, read 422,805 bytes, accepted 97 files, recorded 23 excluded entries and 15 heuristic findings, with no per-file failures. These are one measured snapshot, not fixed metrics or Atlas results. Temporary scan config/output were removed. Atlas Commerce has not been scanned and its checkout remains an unverified input.

Interview challenge: why is path.resolve plus a prefix check insufficient against symlink replacement, and why does a complete discovery report not establish complete code analysis or absence of secrets?


Phase 2 final checks: 9 Python tests and Ruff passed; Node lint/typecheck, 15 Node tests (2 domain integration skips), and API/web/CLI builds passed. Container packaging build passed. The final root-descriptor refinement was tested with a replaced root path; the CLI retains the same descriptor from configuration read through scan. Phase 3 checks are recorded in [the analyzer guide](analyzers.md); Phase 4 graph checks are in [the graph guide](../architecture/context-graph.md) and the engineering journal. No database/API integration or Atlas acceptance is implied by these local scanner checks.
