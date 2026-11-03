"""Local, read-only MCP tools for Hermes; all project access stays on this host."""
import json
import os
import sys
import uuid
from pathlib import Path

from scanner import DEFAULT_EXCLUDED, findings, open_root, read_file, scan

MAX_QUERY_CHARS = 200
MAX_RESULTS = 10
MAX_SNIPPET_CHARS = 360


class ProjectContext:
    """Lazily scan one operator-configured root and expose bounded, screened evidence."""

    def __init__(self, root):
        self.root = Path(root).resolve(strict=True)
        self.project_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"local-project:{self.root}"))
        self._snapshot = None

    def snapshot(self):
        if self._snapshot is None:
            root_fd = open_root(str(self.root))
            try:
                self._snapshot = scan(root_fd, self.project_id, exclusions=DEFAULT_EXCLUDED)
            finally:
                os.close(root_fd)
        return self._snapshot

    def overview(self):
        snapshot = self.snapshot()
        graph = snapshot["graph"]
        return {
            "project": snapshot.get("project_name", self.root.name),
            "scan_status": snapshot["status"],
            "graph_status": graph["status"],
            "files_scanned": snapshot["files_scanned"],
            "nodes": graph["node_count"],
            "edges": graph["edge_count"],
            "coverage": graph["coverage"],
            "note": "Local scan snapshot; refresh by restarting this MCP server. No persistent index or cross-user authorization is provided.",
        }

    def symbols(self, query, limit=8):
        self._validate_query(query)
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_RESULTS:
            raise ValueError("limit must be between 1 and 10")
        graph = self.snapshot()["graph"]
        matches = [node for node in graph["nodes"] if query.casefold() in node["name"].casefold()]
        matches.sort(key=lambda node: (node["type"], node["name"].casefold(), node["id"]))
        return {
            "graph_status": graph["status"],
            "matched_count": len(matches),
            "truncated": len(matches) > limit,
            "results": [
                {"type": node["type"], "name": node["name"], "attributes": node["attributes"],
                 "sources": [{"path": ref["path"], "line_start": ref["line_start"], "line_end": ref["line_end"]}
                             for ref in node["provenance"]]}
                for node in matches[:limit]
            ],
        }

    def search(self, query, limit=5):
        self._validate_query(query)
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 5:
            raise ValueError("limit must be between 1 and 5")
        root_fd = open_root(str(self.root))
        results = []
        try:
            for source in self.snapshot()["sources"]:
                if len(results) >= limit:
                    break
                text = self._read_source(root_fd, source["path"])
                if text is None:
                    continue
                lines = text.splitlines()
                needle = query.casefold()
                for line_number, line in enumerate(lines, start=1):
                    if needle in line.casefold():
                        excerpt = line.strip()
                        results.append({
                            "path": source["path"], "line": line_number,
                            "excerpt": excerpt[:MAX_SNIPPET_CHARS],
                            "truncated": len(excerpt) > MAX_SNIPPET_CHARS,
                            "content_hash": source["content_hash"],
                        })
                        break
        finally:
            os.close(root_fd)
        return {"matched_files_returned": len(results), "results": results,
                "note": "Literal, case-insensitive search over files accepted by the secret-screening scanner."}

    @staticmethod
    def _validate_query(query):
        if not isinstance(query, str) or not 2 <= len(query.strip()) <= MAX_QUERY_CHARS:
            raise ValueError("query must contain between 2 and 200 characters")

    @staticmethod
    def _read_source(root_fd, relative_path):
        parts = relative_path.split("/")
        current_fd = os.dup(root_fd)
        try:
            for part in parts[:-1]:
                next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current_fd)
                os.close(current_fd)
                current_fd = next_fd
            data = read_file(current_fd, parts[-1], 1_048_576).decode("utf-8")
            return None if findings(data) else data
        except (OSError, ValueError, UnicodeDecodeError):
            return None
        finally:
            os.close(current_fd)


TOOLS = [
    {"name": "project_context_overview", "description": "Get the real scan and code-graph coverage for the configured local project. This is a one-process snapshot.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "search_project_context", "description": "Search screened project files for a literal case-insensitive phrase and return short excerpts with file and line provenance. Use specific terms; this is not semantic search.",
     "inputSchema": {"type": "object", "properties": {"query": {"type": "string", "minLength": 2, "maxLength": 200}, "limit": {"type": "integer", "minimum": 1, "maximum": 5}}, "required": ["query"], "additionalProperties": False}},
    {"name": "find_project_symbols", "description": "Find code graph nodes whose names contain a literal phrase; results include source paths and line ranges.",
     "inputSchema": {"type": "object", "properties": {"query": {"type": "string", "minLength": 2, "maxLength": 200}, "limit": {"type": "integer", "minimum": 1, "maximum": 10}}, "required": ["query"], "additionalProperties": False}},
]


def _response(request_id, result):
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def serve(project):
    """Implement the small MCP stdio surface used by Hermes, with protocol on stdout only."""
    for raw in sys.stdin:
        request = None
        try:
            request = json.loads(raw)
            if not isinstance(request, dict) or request.get("jsonrpc") != "2.0":
                continue
            method, request_id = request.get("method"), request.get("id")
            if method == "notifications/initialized":
                continue
            if method == "initialize":
                result = {"protocolVersion": "2025-03-26", "capabilities": {"tools": {}},
                          "serverInfo": {"name": "local-project-context", "version": "0.1.0"}}
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": TOOLS}
            elif method == "tools/call":
                params = request.get("params", {})
                arguments = params.get("arguments", {})
                if params.get("name") == "project_context_overview":
                    value = project.overview()
                elif params.get("name") == "search_project_context":
                    value = project.search(arguments.get("query"), arguments.get("limit", 5))
                elif params.get("name") == "find_project_symbols":
                    value = project.symbols(arguments.get("query"), arguments.get("limit", 8))
                else:
                    raise ValueError("unknown tool")
                result = {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}], "isError": False}
            else:
                if request_id is not None:
                    print(json.dumps({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "Method not found"}}), flush=True)
                continue
            if request_id is not None:
                print(json.dumps(_response(request_id, result), ensure_ascii=False), flush=True)
        except Exception as error:
            if isinstance(request, dict) and request.get("id") is not None:
                print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "error": {"code": -32602, "message": "Invalid request or local scan failed"}}), flush=True)
            print(f"Hermes MCP request failed: {type(error).__name__}", file=sys.stderr, flush=True)


def main():
    root = os.environ.get("CONTEXT_PROJECT_ROOT")
    if not root:
        print("CONTEXT_PROJECT_ROOT must point to the local project", file=sys.stderr)
        return 2
    try:
        serve(ProjectContext(root))
    except (OSError, ValueError) as error:
        print(f"Cannot open configured project root: {type(error).__name__}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
