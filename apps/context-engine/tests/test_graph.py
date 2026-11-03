import copy
import hashlib
import json
import uuid

import pytest

from graph import (
    GraphInputError,
    GraphQueryError,
    build_graph,
    find_nodes,
    traverse_graph,
)
from local_cli import read_graph_artifact
from scanner import scan

PROJECT_ID = str(uuid.uuid4())


def make_project(root):
    (root / "models.py").write_text(
        "class UserService:\n"
        "    def find_user(self, user_id):\n"
        "        return user_id\n"
    )
    (root / "schema.sql").write_text(
        "CREATE TABLE users (id uuid PRIMARY KEY, email text NOT NULL);\n"
    )
    (root / "package.json").write_text(
        '{"dependencies":{"fastify":"^5.0.0"}}\n'
    )
    (root / "guide.md").write_text("# Context\n")
    (root / "legacy.go").write_text("package legacy\n")
    return scan(root, PROJECT_ID)


def test_graph_is_stable_versioned_scoped_and_source_backed(tmp_path):
    first = make_project(tmp_path)["graph"]
    function = find_nodes(first, node_type="function", name="find_user")["nodes"][0]
    source = next(node for node in first["nodes"] if node["type"] == "file" and node["name"] == "models.py")
    source_reference = function["provenance"][0]
    assert source_reference["source_id"] == source["provenance"][0]["source_id"]
    assert source_reference["content_hash"] == source["attributes"]["content_hash"]
    assert source_reference["line_start"] == 2
    assert first["schema_version"] == 1 and first["graph_version"] == "1"
    assert first["status"] == "partial"
    assert first["coverage"]["unsupported_source_count"] == 1
    assert next(node for node in first["nodes"] if node["name"] == "legacy.go")["attributes"]["analysis_status"] == "unsupported"
    assert all(node["scope"] == {"project_id": PROJECT_ID} for node in first["nodes"])
    assert all(edge["scope"] == {"project_id": PROJECT_ID} for edge in first["edges"])
    assert all(node["generation_id"] == first["generation_id"] for node in first["nodes"])
    assert all(edge["generation_id"] == first["generation_id"] for edge in first["edges"])
    assert first["node_count"] == len(first["nodes"])
    assert first["edge_count"] == len(first["edges"])
    assert "return user_id" not in json.dumps(first)
    assert scan(tmp_path, PROJECT_ID)["graph"] == first

    (tmp_path / "models.py").write_text("# shifted lines\n" + (tmp_path / "models.py").read_text())
    second = scan(tmp_path, PROJECT_ID)["graph"]
    shifted_function = find_nodes(second, node_type="function", name="find_user")["nodes"][0]
    assert shifted_function["id"] == function["id"]
    assert second["generation_id"] != first["generation_id"]
    assert shifted_function["provenance"][0]["line_start"] == 3


def test_graph_queries_are_exact_bounded_and_never_cross_generation_scope(tmp_path):
    graph = make_project(tmp_path)["graph"]
    service = find_nodes(graph, node_type="class", name="UserService")["nodes"][0]
    project = next(node for node in graph["nodes"] if node["type"] == "project")
    result = traverse_graph(graph, project["id"], depth=2, limit=12)
    assert any(node["id"] == service["id"] for node in result["nodes"])
    result_ids = {node["id"] for node in result["nodes"]}
    assert all(edge["source_id"] in result_ids and edge["target_id"] in result_ids for edge in result["edges"])
    assert find_nodes(graph, path="schema.sql")["nodes"][0]["type"] == "file"
    assert find_nodes(graph, node_type="dependency", name="fastify")["nodes"][0]["attributes"]["version_spec"] == "^5.0.0"

    with pytest.raises(GraphQueryError, match="query_selector_required"):
        find_nodes(graph)
    with pytest.raises(GraphQueryError, match="invalid_traversal_depth"):
        traverse_graph(graph, project["id"], depth=5)
    with pytest.raises(GraphQueryError, match="invalid_query_limit"):
        find_nodes(graph, name="UserService", limit=201)
    with pytest.raises(GraphQueryError, match="start_node_not_found"):
        traverse_graph(graph, str(uuid.uuid4()))
    bounded = traverse_graph(graph, project["id"], depth=4, limit=1)
    assert len(bounded["nodes"]) == 1 and bounded["truncated"] and bounded["edges"] == []

    cross_scope = copy.deepcopy(graph)
    cross_scope["edges"][0]["scope"] = {"project_id": str(uuid.uuid4())}
    with pytest.raises(GraphQueryError, match="invalid_graph_edge"):
        find_nodes(cross_scope, node_type="project")


def test_graph_rejects_a_fact_whose_hash_or_lineage_was_changed(tmp_path):
    result = make_project(tmp_path)
    tampered = copy.deepcopy(result)
    tampered["analysis"]["facts"][0]["content_hash"] = hashlib.sha256(b"other").hexdigest()
    with pytest.raises(GraphInputError, match="source_hash_mismatch"):
        build_graph(tampered)


def test_postgresql_table_columns_form_scoped_graph_relationships(tmp_path):
    graph = make_project(tmp_path)["graph"]
    table = find_nodes(graph, node_type="database_entity", name="users")["nodes"][0]
    email_column = find_nodes(graph, node_type="database_entity", name="email")["nodes"][0]
    assert email_column["attributes"]["table"] == "users"
    assert any(
        edge["source_id"] == table["id"] and edge["target_id"] == email_column["id"]
        and edge["relation"] == "contains" and edge["provenance"]
        for edge in graph["edges"]
    )


def test_graph_artifact_reader_rejects_symlinks_and_oversized_files(tmp_path, monkeypatch):
    import local_cli

    artifact_path = tmp_path / "scan.json"
    artifact_path.write_text('{"graph":{"schema_version":1}}')
    assert read_graph_artifact(artifact_path) == {"schema_version": 1}

    artifact_path.write_text('{"graph":{},"graph":{}}')
    with pytest.raises(ValueError, match="duplicate_json_key"):
        read_graph_artifact(artifact_path)
    artifact_path.write_text('{"graph":{"schema_version":1}}')

    monkeypatch.setattr(local_cli, "MAX_GRAPH_ARTIFACT_BYTES", 4)
    with pytest.raises(ValueError, match="graph_artifact_too_large"):
        read_graph_artifact(artifact_path)

    monkeypatch.setattr(local_cli, "MAX_GRAPH_ARTIFACT_BYTES", 1024)
    symlink_path = tmp_path / "linked.json"
    symlink_path.symlink_to(artifact_path)
    with pytest.raises(OSError):
        read_graph_artifact(symlink_path)
