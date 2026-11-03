import json
import os
import subprocess
import uuid
from pathlib import Path

import pytest

from scanner import Limits, scan

PROJECT = str(uuid.uuid4())


def test_discovery_and_provenance(tmp_path):
    (tmp_path / "package.json").write_text(json.dumps({
        "dependencies": {"next": "1", "@nestjs/core": "1", "graphql": "1"},
        "workspaces": ["apps/*"],
    }))
    (tmp_path / "main.ts").write_text("export const answer = 42;\n")
    result = scan(tmp_path, PROJECT)
    assert result["status"] == "complete"
    assert result["files_scanned"] == 2
    assert result["discovery"]["frameworks"] == ["GraphQL", "NestJS", "Next.js"]
    assert result["discovery"]["modules"] is None
    assert result["sources"][0]["project_id"] == PROJECT
    assert result["sources"][0]["line_end"] == 1
    again = scan(tmp_path, PROJECT)
    assert result["sources"] == again["sources"]


def test_secret_canaries_never_escape(tmp_path):
    canary = "ghp_" + "A1b2C3d4E5" * 4
    (tmp_path / "source.ts").write_text(f'const key = "{canary}";')
    (tmp_path / ".env").write_text("PASSWORD=fixture-secret")
    (tmp_path / "credentials.pem").write_text("private material")
    result = scan(tmp_path, PROJECT)
    serialized = json.dumps(result)
    assert canary not in serialized
    assert "fixture-secret" not in serialized
    assert result["files_scanned"] == 0
    assert result["security_findings"][0]["line"] == 1
    assert result["excluded_entries"] == 3


def test_symlink_binary_and_size_limits(tmp_path):
    (tmp_path / "outside").symlink_to("/etc")
    (tmp_path / "link.ts").symlink_to("/etc/passwd")
    (tmp_path / "binary").write_bytes(b"a\x00b")
    (tmp_path / "huge.ts").write_text("x" * 101)
    result = scan(tmp_path, PROJECT, Limits(max_file_bytes=100))
    assert result["files_scanned"] == 0
    assert len([row for row in result["excluded"] if row["reason"] == "symlink"]) == 2
    assert result["failures"] == [{"path": "huge.ts", "reason": "oversized"}]
    assert result["status"] == "partial"


def test_malformed_manifest_and_entry_budget(tmp_path):
    (tmp_path / "package.json").write_text("{ broken")
    result = scan(tmp_path, PROJECT)
    assert result["status"] == "partial"
    assert result["failures"][0]["reason"] == "unreadable_or_invalid_manifest"
    (tmp_path / "other.ts").write_text("hello")
    result = scan(tmp_path, PROJECT, Limits(max_entries=1))
    assert result["limits_reached"]
    with pytest.raises((FileNotFoundError, NotADirectoryError)):
        scan(tmp_path / "absent", PROJECT)


def test_fifo_is_not_read(tmp_path):
    os.mkfifo(tmp_path / "fifo")
    result = scan(tmp_path, PROJECT)
    assert result["failures"] == [{"path": "fifo", "reason": "special_file"}]


def test_cli_init_scan_and_no_overwrite(tmp_path):
    engine = Path(__file__).resolve().parents[1]
    import sys
    def run(*args):
        return subprocess.run([sys.executable, str(engine / "local_cli.py"), *args],
                              capture_output=True, text=True, check=False)
    assert run("init", "--root", str(tmp_path), "--name", "fixture").returncode == 0
    config_before = (tmp_path / ".context-platform.json").read_bytes()
    assert run("init", "--root", str(tmp_path)).returncode == 1
    assert (tmp_path / ".context-platform.json").read_bytes() == config_before
    (tmp_path / "main.py").write_text("print('hello')\n")
    output = tmp_path / "report.json"
    assert run("scan", "--root", str(tmp_path), "--output", str(output)).returncode == 0
    assert json.loads(output.read_text())["files_scanned"] == 1
    assert run("scan", "--root", str(tmp_path), "--output", str(output)).returncode == 1



def test_open_root_survives_path_replacement(tmp_path):
    from scanner import open_root
    root = tmp_path / "approved"
    root.mkdir()
    (root / "safe.ts").write_text("export const safe = true;")
    descriptor = open_root(root)
    try:
        root.rename(tmp_path / "original")
        root.mkdir()
        (root / "replacement.ts").write_text("unapproved")
        result = scan(descriptor, PROJECT)
        assert [source["path"] for source in result["sources"]] == ["safe.ts"]
    finally:
        os.close(descriptor)
