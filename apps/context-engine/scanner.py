"""Bounded local discovery; files are data and are never executed."""
import hashlib
import json
import math
import os
import re
import stat
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from analysis_worker import AnalyzerRunner
from analyzers import analyze_project_rows
from graph import build_graph

VERSION = "4"
SCHEMA_VERSION = 4
CHUNKER_VERSION = "1"
MAX_CHUNK_CHARS = 4_000
CHUNK_OVERLAP_CHARS = 300
MAX_PROJECT_CHUNKS = 20_000
MAX_CHUNKS_PER_SOURCE = 1_000
MAX_PROJECT_CHUNK_BYTES = 16 * 1024 * 1024
MAX_PROJECT_FACTS = 50_000
DEFAULT_EXCLUDED = {".ssh", ".aws", ".azure", ".kube", ".terraform", ".gcloud", ".git", "node_modules", ".venv", ".next", "dist", "build", "coverage",
                    "__pycache__", ".pytest_cache", ".ruff_cache", ".context-platform", ".context-platform.json"}
LANGUAGES = {".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
             ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".sql": "SQL"}
FRAMEWORKS = {"next": "Next.js", "react": "React", "@nestjs/core": "NestJS",
              "graphql": "GraphQL", "mongoose": "MongoDB/Mongoose", "pg": "PostgreSQL",
              "ioredis": "Redis", "vite": "Vite", "typescript": "TypeScript"}
RULES = {
    "credential_assignment": re.compile(r"""(?ix)(?:api[_-]?key|access[_-]?token|password|passwd|secret|jwt[_-]?secret|database_url)
        ["']?\s*[:=]\s*["']?[^\s"',;]{4,}"""),
    "known_credential": re.compile(r"(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)"),
    "private_key": re.compile(r"-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----"),
    "credential_url": re.compile(r"[a-z]+://[^\s/:]+:[^\s/@]+@"),
}
TOKEN = re.compile(r"[A-Za-z0-9_+/=-]{32,}")
SAFE_PATH = re.compile(r"^[A-Za-z0-9_./@+ -]+$")


@dataclass(frozen=True)
class Limits:
    max_file_bytes: int = 1_048_576
    max_total_bytes: int = 52_428_800
    max_entries: int = 20_000
    max_depth: int = 24
    max_seconds: float = 30

    def validate(self):
        if not (1 <= self.max_file_bytes <= 4_194_304 and
                self.max_file_bytes <= self.max_total_bytes <= 104_857_600 and
                1 <= self.max_entries <= 100_000 and 1 <= self.max_depth <= 48 and
                0 < self.max_seconds <= 120):
            raise ValueError("invalid_limits")


def entropy(value):
    return -sum((value.count(c) / len(value)) * math.log2(value.count(c) / len(value))
                for c in set(value))


def findings(text):
    result = []
    for rule, pattern in RULES.items():
        for match in pattern.finditer(text):
            result.append({"rule": rule, "line": text.count("\n", 0, match.start()) + 1})
    for match in TOKEN.finditer(text):
        if entropy(match.group()) >= 4.5:
            result.append({"rule": "high_entropy", "line": text.count("\n", 0, match.start()) + 1})
    return result


def safe_path(path):
    return bool(SAFE_PATH.fullmatch(path)) and not findings(path)


def open_root(root):
    # Resolve the operator-selected root once; all later reads are anchored to descriptors.
    path = Path(root).resolve(strict=True)
    return os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)


def read_file(parent_fd, name, maximum):
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("special_file")
        if before.st_size > maximum:
            raise ValueError("oversized")
        data = bytearray()
        while len(data) <= maximum:
            block = os.read(descriptor, min(65536, maximum + 1 - len(data)))
            if not block:
                break
            data.extend(block)
        after = os.fstat(descriptor)
        if len(data) > maximum:
            raise ValueError("oversized")
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError("changed_during_read")
        return bytes(data)
    finally:
        os.close(descriptor)


def _source_chunks(project_id, source, text, remaining_chunks, remaining_bytes):
    """Make bounded, line-provenanced chunks only after the full file passed secret screening."""
    project_namespace = uuid.UUID(project_id)
    chunks = []
    offset = 0
    start_line = 1
    truncated = False
    while offset < len(text):
        if len(chunks) >= min(MAX_CHUNKS_PER_SOURCE, remaining_chunks):
            truncated = True
            break
        end = min(offset + MAX_CHUNK_CHARS, len(text))
        if end < len(text):
            boundary = text.rfind("\n", offset + MAX_CHUNK_CHARS // 2, end)
            if boundary >= offset:
                end = boundary + 1
        content = text[offset:end]
        next_offset = max(offset + 1, end - CHUNK_OVERLAP_CHARS)
        if content.strip():
            encoded = content.encode("utf-8")
            if len(encoded) > remaining_bytes:
                truncated = True
                break
            newline_count = text.count("\n", offset, end)
            end_line = start_line + newline_count
            if end > offset and text[end - 1] == "\n":
                end_line -= 1
            end_line = max(start_line, end_line)
            content_hash = hashlib.sha256(encoded).hexdigest()
            chunk_index = len(chunks)
            chunk_id = str(uuid.uuid5(
                project_namespace,
                f"context-chunk:{CHUNKER_VERSION}:{source['source_id']}:{chunk_index}:{content_hash}",
            ))
            chunks.append({
                "chunk_id": chunk_id,
                "source_id": source["source_id"],
                "path": source["path"],
                "source_content_hash": source["content_hash"],
                "chunk_content_hash": content_hash,
                "chunk_index": chunk_index,
                "line_start": start_line,
                "line_end": end_line,
                "chunker_version": CHUNKER_VERSION,
                "content": content,
            })
            remaining_bytes -= len(encoded)
        start_line += text.count("\n", offset, next_offset)
        offset = next_offset
    return chunks, remaining_bytes, truncated


def scan(root, project_id, limits=None, exclusions=()):
    limits = limits or Limits()
    limits.validate()
    project_id = str(uuid.UUID(project_id))
    excluded = DEFAULT_EXCLUDED | set(exclusions)
    if any(not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", part) for part in excluded):
        raise ValueError("invalid_exclusion")
    started = time.monotonic()
    sources, skipped, security, failures, analysis_rows, chunks = [], [], [], [], [], []
    analyzer = AnalyzerRunner()
    discovery = {"languages": {}, "frameworks": [], "package_managers": [], "build_tools": [],
                 "runtimes": [], "package_manifests": [], "workspace_patterns": [],
                 "entry_point_candidates": [], "configuration": [], "infrastructure": [],
                 "documentation": [], "api_schemas": [], "database_schema_candidates": [],
                 "modules": None, "apis": None, "database_entities": None}
    entries, bytes_read, limited, analysis_fact_count = 0, 0, False, 0
    chunk_bytes_remaining = MAX_PROJECT_CHUNK_BYTES

    def skip(path, reason):
        skipped.append({"path": path, "reason": reason})

    def walk(fd, prefix="", depth=0):
        nonlocal entries, bytes_read, limited, analysis_fact_count, chunk_bytes_remaining
        with os.scandir(fd) as items:
            for entry in items:
                if entries >= limits.max_entries or time.monotonic() - started >= limits.max_seconds:
                    limited = True
                    return
                entries += 1
                path = prefix + entry.name
                if not safe_path(path):
                    skip("<excluded-sensitive-path>", "unsafe_or_sensitive_path")
                    continue
                if entry.is_symlink():
                    skip(path, "symlink")
                    continue
                name = entry.name.lower()
                if entry.name in excluded:
                    skip(path, "excluded_directory_or_file")
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if depth >= limits.max_depth:
                        skip(path, "depth_limit")
                        limited = True
                        continue
                    try:
                        child = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                        try:
                            walk(child, path + "/", depth + 1)
                        finally:
                            os.close(child)
                    except OSError:
                        failures.append({"path": path, "reason": "directory_unreadable"})
                    if limited:
                        return
                    continue
                if (name.startswith(".env") or name in {".npmrc", ".pypirc", "credentials", "id_rsa", "id_ed25519"}
                        or Path(name).suffix in {".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".jks"}):
                    skip(path, "credential_file")
                    continue
                managers = {"package-lock.json": "npm", "pnpm-lock.yaml": "pnpm",
                            "yarn.lock": "yarn", "uv.lock": "uv", "poetry.lock": "poetry",
                            "bun.lockb": "bun", "bun.lock": "bun"}
                if Path(name).suffix in {".zip", ".tar", ".gz", ".tgz", ".7z", ".rar"}:
                    skip(path, "archive")
                    continue
                if name in managers:
                    discovery["package_managers"].append(managers[name])
                    skip(path, "lockfile_metadata_only")
                    continue
                try:
                    maximum = min(limits.max_file_bytes, limits.max_total_bytes - bytes_read)
                    if maximum <= 0:
                        limited = True
                        return
                    raw = read_file(fd, entry.name, maximum)
                    bytes_read += len(raw)
                    if b"\x00" in raw:
                        skip(path, "binary")
                        continue
                    try:
                        text = raw.decode("utf-8")
                    except UnicodeDecodeError:
                        skip(path, "binary_or_unsupported_encoding")
                        continue
                    detected = findings(text)
                    if detected:
                        security.extend({**item, "path": path} for item in detected)
                        skip(path, "secret_detected")
                        continue
                    suffix = Path(name).suffix
                    if suffix in LANGUAGES:
                        language = LANGUAGES[suffix]
                        discovery["languages"][language] = discovery["languages"].get(language, 0) + 1
                    if suffix in {".md", ".rst", ".txt"}:
                        discovery["documentation"].append(path)
                    if name.startswith(("dockerfile", "compose", "docker-compose")):
                        discovery["infrastructure"].append(path)
                    if name in {"main.ts", "main.py", "index.ts", "index.js", "app.py"}:
                        discovery["entry_point_candidates"].append(path)
                    if name.startswith(("tsconfig", "next.config", "vite.config", "nest-cli")) or name in {"pyproject.toml", "package.json"}:
                        discovery["configuration"].append(path)
                    if "openapi" in name or "swagger" in name or suffix in {".graphql", ".gql"}:
                        discovery["api_schemas"].append(path)
                    if suffix == ".sql" or name in {"schema.prisma"}:
                        discovery["database_schema_candidates"].append(path)
                    if name == "package.json":
                        package = json.loads(text)
                        if not isinstance(package, dict):
                            raise ValueError("invalid_manifest")
                        discovery["package_manifests"].append(path)
                        discovery["runtimes"].append("Node.js")
                        dependencies = {}
                        for key in ("dependencies", "devDependencies"):
                            value = package.get(key, {})
                            if not isinstance(value, dict):
                                raise ValueError("invalid_manifest")  # noqa: TRY004 - safe per-file reason code
                            dependencies.update(value)
                        discovery["frameworks"].extend(FRAMEWORKS[key] for key in dependencies if key in FRAMEWORKS)
                        discovery["build_tools"].extend(key for key in dependencies if key in {"vite", "webpack", "rollup", "esbuild", "turbo", "nx", "@nestjs/cli"})
                        workspace = package.get("workspaces", [])
                        if isinstance(workspace, dict):
                            workspace = workspace.get("packages", [])
                        if isinstance(workspace, list):
                            discovery["workspace_patterns"].extend(value for value in workspace
                                if isinstance(value, str) and safe_path(value.replace("*", "x"))
                                and not value.startswith("/") and ".." not in value.split("/"))
                    if suffix == ".py" or name == "pyproject.toml":
                        discovery["runtimes"].append("Python")
                    if name == "pyproject.toml":
                        import tomllib
                        config = tomllib.loads(text)
                        project = config.get("project", {})
                        if not isinstance(project, dict):
                            raise ValueError("invalid_manifest")
                        deps = project.get("dependencies", [])
                        if isinstance(deps, list) and any(isinstance(d, str) and re.match(r"(?i)^fastapi\b", d) for d in deps):
                            discovery["frameworks"].append("FastAPI")
                    source = {"source_id": str(uuid.uuid5(uuid.UUID(project_id), path)),
                              "project_id": project_id, "path": path,
                              "content_hash": hashlib.sha256(raw).hexdigest(),
                              "bytes": len(raw), "line_start": 1 if text else None,
                              "line_end": len(text.splitlines()) if text else None}
                    sources.append(source)
                    source_chunks, chunk_bytes_remaining, chunk_truncated = _source_chunks(
                        project_id, source, text,
                        MAX_PROJECT_CHUNKS - len(chunks), chunk_bytes_remaining,
                    )
                    chunks.extend(source_chunks)
                    if chunk_truncated:
                        limited = True
                        failures.append({"path": path, "reason": "project_chunk_limit"})
                    analyzed = analyzer.analyze(path, source["source_id"], raw)
                    if analysis_fact_count + len(analyzed["facts"]) > MAX_PROJECT_FACTS:
                        failures.append({"path": path, "reason": "analysis_fact_limit"})
                        analysis_rows.append({"path": path, "status": "failed", "reason": "analysis_fact_limit",
                                              "duration_ms": analyzed["duration_ms"], "facts": []})
                        source["analysis_status"] = "failed"
                        limited = True
                        return
                    analysis_fact_count += len(analyzed["facts"])
                    max_line = source["line_end"] or 1
                    for fact in analyzed["facts"]:
                        if not (1 <= fact["line_start"] <= fact["line_end"] <= max_line):
                            analyzed = {**analyzed, "status": "failed", "reason": "invalid_source_range", "facts": []}
                            failures.append({"path": path, "reason": "invalid_source_range"})
                            break
                        # Bind every fact to the exact screened bytes, not just the stable path ID.
                        fact["content_hash"] = source["content_hash"]
                    source["analysis_status"] = analyzed["status"]
                    analysis_rows.append({"path": path, **analyzed})
                except (OSError, ValueError, RecursionError) as error:
                    reason = str(error) if isinstance(error, ValueError) and str(error) in {
                        "oversized", "special_file", "changed_during_read", "invalid_manifest"} else "unreadable_or_invalid_manifest"
                    failures.append({"path": path, "reason": reason})

    root_fd = os.dup(root) if isinstance(root, int) else open_root(root)
    try:
        walk(root_fd)
    finally:
        os.close(root_fd)
        analyzer.close()
    analysis = analyze_project_rows(analysis_rows)
    failures.extend(analysis["failures"])
    for key, value in discovery.items():
        if isinstance(value, list):
            discovery[key] = sorted(set(value))
    result = {"schema_version": SCHEMA_VERSION, "scanner_version": VERSION, "project_id": project_id,
              "chunker_version": CHUNKER_VERSION,
              "status": "partial" if limited or failures or analysis["status"] == "partial" else "complete",
              "limits_reached": limited, "duration_ms": round((time.monotonic() - started) * 1000, 3),
              "entries_observed": entries, "bytes_read": bytes_read, "files_scanned": len(sources),
              "excluded_entries": len(skipped), "failures": sorted(failures, key=lambda r: r["path"]),
              "security_findings": security, "discovery": discovery,
              "sources": sorted(sources, key=lambda r: r["path"]), "chunks": chunks,
              "chunk_count": len(chunks), "chunk_content_bytes": MAX_PROJECT_CHUNK_BYTES - chunk_bytes_remaining,
              "analysis": analysis, "excluded": skipped}
    result["graph"] = build_graph(result)
    return result

