"""Local JSON protocol used by the TypeScript CLI. No platform credentials needed."""
import argparse
import json
import os
import stat
import sys
import uuid

from graph import GraphInputError, GraphQueryError, find_nodes, traverse_graph
from mlx_client import MlxConfigurationError, MlxRequestError, generate
from retrieval import search_published_graph
from scanner import open_root, read_file, safe_path, scan
from storage import InjectedIndexInterruption, StorageError, delete_environment, persist_graph, rollback_generation

CONFIG = ".context-platform.json"
MAX_GRAPH_ARTIFACT_BYTES = 96 * 1024 * 1024


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_json_key")
        result[key] = value
    return result


def read_context_artifact(path):
    """Read a bounded scanner artifact as non-executable JSON, including approved source chunks."""
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("invalid_graph_artifact")
        if before.st_size > MAX_GRAPH_ARTIFACT_BYTES:
            raise ValueError("graph_artifact_too_large")
        data = bytearray()
        while len(data) <= MAX_GRAPH_ARTIFACT_BYTES:
            block = os.read(descriptor, min(65536, MAX_GRAPH_ARTIFACT_BYTES + 1 - len(data)))
            if not block:
                break
            data.extend(block)
        after = os.fstat(descriptor)
        if len(data) > MAX_GRAPH_ARTIFACT_BYTES or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError("invalid_graph_artifact")
        artifact = json.loads(data, object_pairs_hook=_unique_json_object)
    finally:
        os.close(descriptor)
    if not isinstance(artifact, dict) or not isinstance(artifact.get("graph"), dict):
        raise TypeError("graph_artifact_missing_graph")
    if "chunks" in artifact and not isinstance(artifact["chunks"], list):
        raise TypeError("context_artifact_chunks_invalid")
    return artifact


def read_graph_artifact(path):
    return read_context_artifact(path)["graph"]


def write_exclusive(path, payload):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(payload, stream, indent=2)
        stream.write("\n")


def scan_project(root):
    root_fd = open_root(root)
    try:
        config = json.loads(read_file(root_fd, CONFIG, 16384))
        if (not isinstance(config, dict) or config.get("schema_version") != 1
                or not isinstance(config.get("project_id"), str)
                or not isinstance(config.get("name"), str) or not safe_path(config["name"])
                or len(config["name"]) > 80 or "/" in config["name"]
                or not isinstance(config.get("exclude_names", []), list)
                or not all(isinstance(value, str) for value in config.get("exclude_names", []))):
            raise ValueError("invalid_configuration")
        result = scan(root_fd, config["project_id"], exclusions=config.get("exclude_names", []))
        result["project_name"] = config["name"]
        return result
    finally:
        os.close(root_fd)


def main():
    parser = argparse.ArgumentParser(prog="context")
    commands = parser.add_subparsers(dest="command", required=True)
    init_command = commands.add_parser("init")
    init_command.add_argument("--root", default=".")
    init_command.add_argument("--name", default="local-project")
    scan_command = commands.add_parser("scan")
    scan_command.add_argument("--root", default=".")
    scan_command.add_argument("--output")

    graph_command = commands.add_parser("graph")
    graph_commands = graph_command.add_subparsers(dest="graph_command", required=True)
    graph_find = graph_commands.add_parser("find")
    graph_find.add_argument("--artifact", required=True)
    graph_find.add_argument("--type", dest="node_type")
    graph_find.add_argument("--name")
    graph_find.add_argument("--path")
    graph_find.add_argument("--limit", type=int, default=50)
    graph_traverse = graph_commands.add_parser("traverse")
    graph_traverse.add_argument("--artifact", required=True)
    graph_traverse.add_argument("--node-id", required=True)
    graph_traverse.add_argument("--depth", type=int, default=1)
    graph_traverse.add_argument("--limit", type=int, default=100)
    graph_traverse.add_argument("--direction", choices=("out", "in", "both"), default="both")

    index_command = commands.add_parser("index", help="Persist and publish a validated graph artifact to PostgreSQL")
    index_command.add_argument("--artifact", required=True)
    index_command.add_argument("--root", help="Re-scan and verify this project before persisting source chunks")
    index_command.add_argument("--tenant-id", required=True, help="Explicit owning tenant UUID")
    index_command.add_argument("--environment-id", required=True, help="Explicit environment UUID")
    index_command.add_argument("--environment-name", default="local")
    index_command.add_argument("--inject-interruption-after-checkpoints", type=int, help="Failure experiment: stop after 1–10 durable batches and leave the generation unpublished")

    storage_command = commands.add_parser("storage", help="Operate on persisted graph generations")
    storage_commands = storage_command.add_subparsers(dest="storage_command", required=True)
    rollback_command = storage_commands.add_parser("rollback", help="Point an environment at an older published generation")
    rollback_command.add_argument("--tenant-id", required=True)
    rollback_command.add_argument("--project-id", required=True)
    rollback_command.add_argument("--environment-id", required=True)
    rollback_command.add_argument("--generation-id", required=True)
    delete_command = storage_commands.add_parser("delete-environment", help="Delete all stored context for one environment")
    delete_command.add_argument("--tenant-id", required=True)
    delete_command.add_argument("--project-id", required=True)
    delete_command.add_argument("--environment-id", required=True)
    delete_command.add_argument("--confirm-environment-id", required=True)
    search_command = storage_commands.add_parser("search", help="Search the current published graph for one local project scope")
    search_command.add_argument("--tenant-id", required=True)
    search_command.add_argument("--project-id", required=True)
    search_command.add_argument("--environment-id", required=True)
    search_command.add_argument("--query", required=True)
    search_command.add_argument("--limit", type=int, default=10)

    ai_command = commands.add_parser("ai", help="Use an explicitly configured local inference provider")
    ai_commands = ai_command.add_subparsers(dest="ai_command", required=True)
    ai_commands.add_parser("ask", help="Chat interactively or generate one response from piped input")

    args = parser.parse_args()
    try:
        if args.command == "graph":
            graph = read_graph_artifact(args.artifact)
            if args.graph_command == "find":
                result = find_nodes(graph, node_type=args.node_type, name=args.name, path=args.path, limit=args.limit)
            else:
                result = traverse_graph(graph, args.node_id, depth=args.depth, limit=args.limit, direction=args.direction)
            print(json.dumps(result))
            return 0

        if args.command == "index":
            artifact = read_context_artifact(args.artifact)
            if args.root:
                current = scan_project(args.root)
                if current["graph"] != artifact["graph"]:
                    raise ValueError("artifact_does_not_match_current_project")
                artifact = current
            elif artifact.get("chunks"):
                raise ValueError("source_chunks_require_root_rescan")
            graph = artifact["graph"]
            result = persist_graph(
                graph,
                chunks=artifact.get("chunks", []),
                database_url=os.environ.get("DATABASE_URL"),
                tenant_id=args.tenant_id,
                environment_id=args.environment_id,
                environment_name=args.environment_name,
                interrupt_after_checkpoints=args.inject_interruption_after_checkpoints,
            )
            print(json.dumps(result))
            return 0

        if args.command == "storage" and args.storage_command == "rollback":
            result = rollback_generation(
                database_url=os.environ.get("DATABASE_URL"),
                tenant_id=args.tenant_id,
                project_id=args.project_id,
                environment_id=args.environment_id,
                generation_id=args.generation_id,
            )
            print(json.dumps(result))
            return 0

        if args.command == "storage" and args.storage_command == "delete-environment":
            result = delete_environment(
                database_url=os.environ.get("DATABASE_URL"),
                tenant_id=args.tenant_id,
                project_id=args.project_id,
                environment_id=args.environment_id,
                confirmation=args.confirm_environment_id,
            )
            print(json.dumps(result))
            return 0

        if args.command == "storage" and args.storage_command == "search":
            result = search_published_graph(
                database_url=os.environ.get("DATABASE_URL"),
                tenant_id=args.tenant_id,
                project_id=args.project_id,
                environment_id=args.environment_id,
                query=args.query,
                limit=args.limit,
            )
            print(json.dumps(result, ensure_ascii=False))
            return 0

        if args.command == "ai" and args.ai_command == "ask":
            if sys.stdin.isatty():
                return interactive_chat()
            prompt = sys.stdin.read(32_001)
            result = generate(prompt)
            print_generation(result)
            return 0

        if args.command == "init":
            root_fd = open_root(args.root)
            try:
                if not safe_path(args.name) or "/" in args.name or len(args.name) > 80:
                    raise ValueError("invalid_project_name")
                config = {"schema_version": 1, "project_id": str(uuid.uuid4()), "name": args.name, "exclude_names": []}
                descriptor = os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=root_fd)
                with os.fdopen(descriptor, "w") as stream:
                    json.dump(config, stream, indent=2)
                print(json.dumps({"status": "initialized", "project_id": config["project_id"], "name": args.name}))
                return 0
            finally:
                os.close(root_fd)

        result = scan_project(args.root)
        if args.output:
            write_exclusive(args.output, result)
        # Summary intentionally omits source paths and finding locations from ordinary console output.
        summary = {key: value for key, value in result.items() if key not in {
            "sources", "excluded", "security_findings", "failures", "discovery", "analysis", "graph",
            "chunks",
        }}
        summary["security_findings_count"] = len(result["security_findings"])
        summary["failed_files"] = len(result["failures"])
        summary["analysis"] = {key: result["analysis"][key] for key in
                                ("schema_version", "analyzer_version", "status", "files_analyzed", "files_partial", "files_unsupported", "files_failed", "facts_count", "facts_by_kind", "parse_duration_ms")}
        summary["graph"] = {key: result["graph"][key] for key in
                             ("schema_version", "graph_version", "status", "generation_id", "node_count", "edge_count", "coverage")}
        summary["discovery"] = {k: result["discovery"][k] for k in
                                ("languages", "frameworks", "runtimes", "package_managers", "build_tools", "modules", "apis", "database_entities")}
        print(json.dumps(summary))
        return 2 if result["status"] == "partial" else 0
    except (MlxConfigurationError, MlxRequestError) as error:
        print(f"AI request failed: {error}", file=sys.stderr)
        return 1
    except StorageError as error:
        print(f"Context index failed: {error}", file=sys.stderr)
        return 1
    except InjectedIndexInterruption as error:
        print(f"Failure experiment: {error}", file=sys.stderr)
        return 3
    except (OSError, ValueError, KeyError, TypeError, RecursionError, GraphInputError, GraphQueryError):
        print(json.dumps({"error": "local_operation_failed", "message": "Check the selected root or graph artifact, configuration and query inputs."}), file=sys.stderr)
        return 1


def interactive_chat():
    """Keep this terminal session's conversation history in each model request."""
    history = []
    print("Local MLX chat. Use :reset to clear context or :quit to exit.")
    while True:
        try:
            prompt = input("You: ")
        except EOFError:
            print()
            return 0
        command = prompt.strip().casefold()
        if command in {":quit", ":exit"}:
            return 0
        if command == ":reset":
            history.clear()
            print("Conversation context cleared.")
            continue
        if command == ":help":
            print("Enter a prompt; prior turns stay in this session. Commands: :reset, :quit.")
            continue
        if not prompt.strip():
            continue
        try:
            result = generate(prompt, history=history)
        except (MlxConfigurationError, MlxRequestError) as error:
            print(f"AI request failed: {error}", file=sys.stderr)
            continue
        print_generation(result)
        history.extend([
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": result.text},
        ])


def print_generation(result):
    print(f"AI: {result.text}\n")
    print(
        f"Context budget estimate: prompt={result.prompt_token_estimate}, "
        f"reserved_output={result.reserved_output_tokens}, "
        f"total={result.prompt_token_estimate + result.reserved_output_tokens}/"
        f"{result.context_window_tokens} configured tokens",
        file=sys.stderr,
    )


if __name__ == "__main__":
    sys.exit(main())

