"""Local JSON protocol used by the TypeScript CLI. No platform credentials needed."""
import argparse
import json
import os
import sys
import uuid

from scanner import open_root, read_file, safe_path, scan

CONFIG = ".context-platform.json"


def write_exclusive(path, payload):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(payload, stream, indent=2)
        stream.write("\n")


def main():
    parser = argparse.ArgumentParser(prog="context")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "scan"):
        command = commands.add_parser(name)
        command.add_argument("--root", default=".")
        if name == "init":
            command.add_argument("--name", default="local-project")
        else:
            command.add_argument("--output")
    args = parser.parse_args()
    try:
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
        summary = {key: value for key, value in result.items() if key not in {"sources", "excluded", "security_findings", "failures", "discovery"}}
        summary["security_findings_count"] = len(result["security_findings"])
        summary["failed_files"] = len(result["failures"])
        summary["discovery"] = {k: result["discovery"][k] for k in
                                ("languages", "frameworks", "runtimes", "package_managers", "build_tools", "modules", "apis", "database_entities")}
        print(json.dumps(summary))
        return 2 if result["status"] == "partial" else 0
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps({"error": "local_scan_failed", "message": "Check root, initialization, configuration, output existence and access permissions."}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

