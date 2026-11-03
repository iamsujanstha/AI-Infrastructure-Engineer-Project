"""Local JSON protocol used by the TypeScript CLI. No platform credentials needed."""
import argparse
import json
import os
import stat
import sys
import uuid

from graph import GraphInputError, GraphQueryError, find_nodes, traverse_graph
from mlx_client import MlxConfigurationError, MlxRequestError, generate
from scanner import open_root, read_file, safe_path, scan

CONFIG = ".context-platform.json"
MAX_GRAPH_ARTIFACT_BYTES = 64 * 1024 * 1024


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_json_key")
        result[key] = value
    return result


def read_graph_artifact(path):
    """Read an operator-selected graph artifact as bounded, non-executable JSON data."""
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
    return artifact["graph"]


def write_exclusive(path, payload):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(payload, stream, indent=2)
        stream.write("\n")


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

        if args.command == "ai" and args.ai_command == "ask":
            if sys.stdin.isatty():
                return interactive_chat()
            prompt = sys.stdin.read(32_001)
            result = generate(prompt)
            print_generation(result)
            return 0

        root_fd = open_root(args.root)
        try:
            if args.command == "init":
                if not safe_path(args.name) or "/" in args.name or len(args.name) > 80:
                    raise ValueError("invalid_project_name")
                config = {"schema_version": 1, "project_id": str(uuid.uuid4()), "name": args.name, "exclude_names": []}
                descriptor = os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=root_fd)
                with os.fdopen(descriptor, "w") as stream:
                    json.dump(config, stream, indent=2)
                print(json.dumps({"status": "initialized", "project_id": config["project_id"], "name": args.name}))
                return 0
            config = json.loads(read_file(root_fd, CONFIG, 16384))
            if (not isinstance(config, dict) or config.get("schema_version") != 1
                    or not isinstance(config.get("project_id"), str)
                    or not isinstance(config.get("name"), str) or not safe_path(config["name"])
                    or len(config["name"]) > 80 or "/" in config["name"]
                    or not isinstance(config.get("exclude_names", []), list)
                    or not all(isinstance(v, str) for v in config.get("exclude_names", []))):
                raise ValueError("invalid_configuration")
            result = scan(root_fd, config["project_id"], exclusions=config.get("exclude_names", []))
            result["project_name"] = config["name"]
        finally:
            os.close(root_fd)
        if args.output:
            write_exclusive(args.output, result)
        # Summary intentionally omits source paths and finding locations from ordinary console output.
        summary = {key: value for key, value in result.items() if key not in {
            "sources", "excluded", "security_findings", "failures", "discovery", "analysis", "graph",
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

