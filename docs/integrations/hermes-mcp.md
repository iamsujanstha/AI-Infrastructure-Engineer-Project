# Hermes local project-context integration

## Scope

The context engine exposes a local, read-only MCP stdio server that Hermes can call while composing an answer. Hermes remains the agent and model runtime; this adapter supplies screened project evidence. It does not wire Hermes into the browser chat or make the browser chat use Hermes.

This is a single-operator development integration over the existing Phase 4 scanner and graph. The server reads one root selected by `CONTEXT_PROJECT_ROOT`, scans lazily on the first tool call, and holds that snapshot for the process lifetime. No API token, network listener, persistent index, tenant boundary, or authorization layer is added. Do not point it at repositories containing data you are not authorized to expose to the local Hermes process.

## Tools

- `project_context_overview`: returns actual scan and graph coverage from the current local scan.
- `search_project_context`: literal, case-insensitive search over scanner-accepted source files. Returns bounded matching lines with relative path, line number, and content hash. It is lexical search, not semantic retrieval.
- `find_project_symbols`: literal substring search over graph node names, with source paths and line ranges.

The scanner excludes configured sensitive paths, credential file types, and files with detected secret patterns. Files are reopened with descriptor-relative no-follow operations and screened again before excerpts are returned. Tool arguments cannot select a filesystem root or arbitrary path. Hermes receives the excerpts as untrusted tool output and must cite their paths when making project-specific claims.

## Install and operate

The local Hermes CLI registration is named `project-context`. Its command uses this checkout's `apps/context-engine/.venv/bin/python`, runs `apps/context-engine/hermes_mcp.py`, and sets `CONTEXT_PROJECT_ROOT` to the repository root. The command is local stdio; it requires no API token.

Check the registration with `hermes mcp list` and `hermes mcp test project-context`. If the Python environment or checkout moves, update the server command and environment in `~/.hermes/config.yaml` with `hermes mcp add` or `hermes mcp configure`, then run `/reload-mcp` in Hermes. Hermes prefixes tools with the MCP server name in its tool list.

## Failure and recovery experiment

1. Run `hermes mcp test project-context`; the server should initialize and enumerate its three tools.
2. Ask Hermes to use `project_context_overview`, then `search_project_context` with a distinctive phrase present in this repository. Confirm returned evidence paths and line numbers against the checkout.
3. Stop or rename the configured project root while Hermes is running and request a new MCP process/tool call. The server should fail closed with a generic tool error and a type-only stderr diagnostic; it must not return a made-up empty result.
4. Restore the root and restart/reload the MCP server. The next request should scan again and return real results.
5. For snapshot freshness, edit a harmless source after the first tool call. The existing process intentionally keeps its original scan metadata; restart/reload the MCP server and confirm the changed content is searchable.

The failure steps above are an experiment procedure; they have not been performed as part of this change. Avoid renaming or removing a live project root merely to run the experiment.

## Decisions and limits

- **Problem:** let Hermes retrieve local project evidence without exposing a database or adding network endpoints.
- **Alternatives:** Hermes shell access (broader privileges), an HTTP tool endpoint (network/auth surface), or a future authenticated `AgentContextProvider` (requires identity, durable indexing and retrieval policy).
- **Decision:** local stdio MCP with fixed root and three bounded read-only tools, implemented without another runtime dependency.
- **Tradeoffs:** literal search can miss synonyms and broad questions; the initial scan may delay the first tool call; the snapshot becomes stale until the MCP process restarts; no per-user/object authorization exists.
- **Load and scale:** scans are bounded by scanner limits (30 seconds, entry/byte/depth caps). Each server process holds one in-memory graph/snapshot. Multiple Hermes processes duplicate scan work and memory. Durable incremental indexing, semantic/hybrid retrieval, and owner-scoped authorization are required before multi-user or shared deployment.
- **Security and observability:** no network listener or credentials are introduced. Source excerpts are returned only from files accepted by the local secret-screening scanner. Failures are generic over the MCP protocol; stderr logs only the exception type, not prompts, file contents, or secrets.
- **Interview question:** Why is a local stdio MCP server a narrower integration boundary than giving an agent shell access, and what additional controls are required before exposing the same capability to multiple users?
