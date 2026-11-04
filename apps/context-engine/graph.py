"""Deterministic, source-backed local context graph construction and queries."""
import hashlib
import json
import re
import uuid
from collections import defaultdict, deque

GRAPH_VERSION = "1"
MAX_QUERY_NODES = 200
MAX_TRAVERSAL_DEPTH = 4
MAX_GRAPH_NODES = 75_000
MAX_GRAPH_EDGES = 150_000
MAX_SOURCE_BYTES = 1_048_576
SAFE_RELATIVE_PATH = re.compile(r"^[A-Za-z0-9_./@+ -]{1,1024}$")
NODE_TYPES = {
    "project", "file", "module", "class", "function", "api", "database_entity",
    "document", "dependency",
}
NODE_FACTS = {
    "class": ("class", "symbol"),
    "interface": ("class", "symbol"),
    "type": ("class", "symbol"),
    "enum": ("class", "symbol"),
    "function": ("function", "symbol"),
    "method": ("function", "symbol"),
    "nest_module": ("module", "module"),
    "rest_route": ("api", "api"),
    "graphql_operation": ("api", "api"),
    "graphql_resolver_operation": ("api", "api"),
    "graphql_type": ("api", "api"),
    "graphql_interface": ("api", "api"),
    "graphql_input": ("api", "api"),
    "graphql_enum": ("api", "api"),
    "graphql_union": ("api", "api"),
    "graphql_scalar": ("api", "api"),
    "graphql_field": ("api", "api"),
    "openapi_operation": ("api", "api"),
    "openapi_schema": ("api", "api"),
    "database_table": ("database_entity", "table"),
    "database_column": ("database_entity", "column"),
    "documentation_section": ("document", "section"),
    "dependency": ("dependency", "declared_dependency"),
    "import": ("dependency", "import_target"),
}


class GraphInputError(ValueError):
    """The scan artifact cannot support a provenance-safe graph."""


class GraphQueryError(ValueError):
    """The bounded local graph query is invalid or its start node is absent."""


def _canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _stable_id(namespace, kind, identity):
    return str(uuid.uuid5(namespace, f"context-graph:{GRAPH_VERSION}:{kind}:{_canonical(identity)}"))


def _valid_provenance(reference):
    if not isinstance(reference, dict):
        return False
    source_id, path = reference.get("source_id"), reference.get("path")
    content_hash, analyzer_version = reference.get("content_hash"), reference.get("analyzer_version")
    try:
        valid_source_id = str(uuid.UUID(source_id)) == source_id
    except (ValueError, TypeError, AttributeError):
        valid_source_id = False
    path_parts = path.split("/") if isinstance(path, str) else []
    if (not valid_source_id or not isinstance(path, str) or not SAFE_RELATIVE_PATH.fullmatch(path)
            or path.startswith("/") or any(part in {"", ".", ".."} for part in path_parts)
            or not isinstance(content_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", content_hash)
            or not isinstance(analyzer_version, str)):
        return False
    start, end = reference.get("line_start"), reference.get("line_end")
    if start is None and end is None:
        return True
    return (isinstance(start, int) and not isinstance(start, bool)
            and isinstance(end, int) and not isinstance(end, bool) and 1 <= start <= end)


def _source_reference(fact, sources, analyzer_version):
    source_id = fact.get("source_id")
    source = sources.get(source_id)
    if source is None or fact.get("path") != source.get("path"):
        raise GraphInputError("missing_source_provenance")
    if fact.get("content_hash") != source.get("content_hash"):
        raise GraphInputError("source_hash_mismatch")
    start, end = fact.get("line_start"), fact.get("line_end")
    last_line = source.get("line_end") or 0
    if (not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int)
            or isinstance(end, bool) or not 1 <= start <= end <= last_line):
        raise GraphInputError("invalid_source_range")
    reference = {
        "source_id": source_id,
        "path": source["path"],
        "content_hash": source["content_hash"],
        "line_start": start,
        "line_end": end,
        "analyzer_version": analyzer_version,
    }
    for key in ("evidence", "adapter", "parse_quality"):
        value = fact.get(key)
        if isinstance(value, str):
            reference[key] = value
    return reference


def _fact_name(fact):
    name = fact.get("name")
    if isinstance(name, str) and name:
        return name
    if fact.get("kind") in {"rest_route", "openapi_operation"}:
        method, route = fact.get("http_method"), fact.get("route")
        if isinstance(method, str) and isinstance(route, str):
            return f"{method} {route}"
    return None


def _attributes(fact, subtype):
    attributes = {"fact_kind": fact["kind"], "subtype": subtype}
    for key in ("http_method", "route", "operation_type", "version_spec", "ecosystem",
                "adapter", "data_type", "table", "heading_level", "parse_quality"):
        value = fact.get(key)
        if isinstance(value, (str, int)) and not isinstance(value, bool):
            attributes[key] = value
    if subtype == "symbol":
        attributes["symbol_kind"] = fact["kind"]
    if subtype == "import_target":
        attributes["resolved"] = False
    return attributes


def build_graph(scan_result):
    """Build a versioned graph from a validated Phase 3 scanner artifact."""
    if not isinstance(scan_result, dict):
        raise GraphInputError("invalid_scan_artifact")
    project_id = scan_result.get("project_id")
    try:
        project_uuid = uuid.UUID(project_id)
    except (ValueError, TypeError, AttributeError) as error:
        raise GraphInputError("invalid_project_scope") from error
    if str(project_uuid) != project_id:
        raise GraphInputError("invalid_project_scope")

    sources_list = scan_result.get("sources")
    analysis = scan_result.get("analysis")
    if not isinstance(sources_list, list) or not isinstance(analysis, dict):
        raise GraphInputError("invalid_scan_artifact")
    sources = {}
    for source in sources_list:
        if not isinstance(source, dict):
            raise GraphInputError("invalid_source_record")
        source_id, path, content_hash = source.get("source_id"), source.get("path"), source.get("content_hash")
        path_parts = path.split("/") if isinstance(path, str) else []
        if (not isinstance(source_id, str) or not isinstance(path, str) or not SAFE_RELATIVE_PATH.fullmatch(path)
                or path.startswith("/") or any(part in {"", ".", ".."} for part in path_parts)
                or not isinstance(content_hash, str)
                or not re.fullmatch(r"[a-f0-9]{64}", content_hash) or source_id in sources):
            raise GraphInputError("invalid_source_record")
        try:
            canonical_source_id = str(uuid.UUID(source_id))
        except ValueError as error:
            raise GraphInputError("invalid_source_record") from error
        if canonical_source_id != source_id:
            raise GraphInputError("invalid_source_record")
        if not isinstance(source.get("analysis_status"), str):
            raise GraphInputError("invalid_source_status")
        byte_count = source.get("bytes")
        if (not isinstance(byte_count, int) or isinstance(byte_count, bool)
                or not 0 <= byte_count <= MAX_SOURCE_BYTES):
            raise GraphInputError("invalid_source_record")
        first, last = source.get("line_start"), source.get("line_end")
        if not ((first is None and last is None) or (
            isinstance(first, int) and not isinstance(first, bool)
            and isinstance(last, int) and not isinstance(last, bool) and 1 <= first <= last
        )):
            raise GraphInputError("invalid_source_record")
        sources[source_id] = source

    facts = analysis.get("facts")
    analyzer_version = analysis.get("analyzer_version")
    if not isinstance(facts, list) or not isinstance(analyzer_version, str):
        raise GraphInputError("invalid_analysis_artifact")
    if any(not isinstance(fact, dict) for fact in facts):
        raise GraphInputError("invalid_analysis_fact")
    source_statuses = {
        source_id: source.get("analysis_status", "unsupported")
        for source_id, source in sources.items()
    }
    if any(status not in {"analyzed", "partial", "failed", "unsupported"} for status in source_statuses.values()):
        raise GraphInputError("invalid_source_status")
    for fact in facts:
        if source_statuses.get(fact.get("source_id")) not in {"analyzed", "partial"}:
            raise GraphInputError("fact_from_unavailable_source")
        _source_reference(fact, sources, analyzer_version)

    identity_payload = {
        "graph_version": GRAPH_VERSION,
        "chunker_version": scan_result.get("chunker_version"),
        "scanner_version": scan_result.get("scanner_version"),
        "analyzer_version": analyzer_version,
        "scan_status": scan_result.get("status"),
        "analysis_status": analysis.get("status"),
        "limits_reached": bool(scan_result.get("limits_reached")),
        "sources": sorted(
            ({"source_id": source_id, "path": source["path"], "content_hash": source["content_hash"],
              "analysis_status": source_statuses[source_id]}
             for source_id, source in sources.items()),
            key=lambda item: item["source_id"],
        ),
        "failures": scan_result.get("failures", []),
    }
    digest = hashlib.sha256(_canonical(identity_payload).encode("ascii")).hexdigest()
    generation_id = _stable_id(project_uuid, "generation", digest)
    scope = {"project_id": project_id}
    nodes = {}
    edges = {}

    def add_node(node_id, node_type, name, attributes, provenance):
        if node_id not in nodes:
            nodes[node_id] = {
                "id": node_id,
                "type": node_type,
                "name": name,
                "scope": scope.copy(),
                "generation_id": generation_id,
                "attributes": attributes,
                "provenance": [provenance] if provenance else [],
            }
        elif provenance:
            current = nodes[node_id]["provenance"]
            if provenance not in current:
                current.append(provenance)
                current.sort(key=lambda item: (item["source_id"], item["line_start"], item["line_end"]))

    def add_edge(source_id, target_id, relation, provenance):
        key = (source_id, target_id, relation)
        edge_id = _stable_id(project_uuid, "edge", key)
        if key not in edges:
            edges[key] = {
                "id": edge_id,
                "source_id": source_id,
                "target_id": target_id,
                "relation": relation,
                "scope": scope.copy(),
                "generation_id": generation_id,
                "provenance": [],
            }
        if provenance not in edges[key]["provenance"]:
            edges[key]["provenance"].append(provenance)

    project_node_id = _stable_id(project_uuid, "project", project_id)
    add_node(project_node_id, "project", project_id, {"local_artifact": True}, None)
    file_ids = {}
    for source_id, source in sorted(sources.items(), key=lambda item: item[1]["path"]):
        file_id = _stable_id(project_uuid, "file", source_id)
        file_ids[source_id] = file_id
        source_ref = {
            "source_id": source_id, "path": source["path"], "content_hash": source["content_hash"],
            "line_start": source.get("line_start"), "line_end": source.get("line_end"),
            "analyzer_version": analyzer_version,
        }
        if not _valid_provenance(source_ref):
            raise GraphInputError("invalid_source_record")
        add_node(file_id, "file", source["path"], {
            "bytes": source.get("bytes", 0),
            "analysis_status": source_statuses[source_id],
            "content_hash": source["content_hash"],
        }, source_ref)
        add_edge(project_node_id, file_id, "contains", source_ref)

    recognized = []
    for fact in facts:
        mapping = NODE_FACTS.get(fact.get("kind"))
        if mapping is None:
            continue
        name = _fact_name(fact)
        if not isinstance(name, str) or not 1 <= len(name) <= 500:
            continue
        source_ref = _source_reference(fact, sources, analyzer_version)
        node_type, subtype = mapping
        identity = [
            fact["source_id"], fact["kind"], name,
            fact.get("table"), fact.get("http_method"), fact.get("route"), fact.get("operation_type"),
        ]
        recognized.append((fact["source_id"], fact, source_ref, node_type, subtype, name, identity))

    recognized.sort(key=lambda item: (
        item[0], item[3], _canonical(item[6]), item[1]["line_start"], item[1]["line_end"],
    ))
    occurrence = defaultdict(int)
    fact_node_ids = {}
    table_ids = {}
    for source_id, fact, source_ref, node_type, subtype, name, identity in recognized:
        ordinal_key = _canonical(identity)
        ordinal = occurrence[ordinal_key]
        occurrence[ordinal_key] += 1
        node_id = _stable_id(project_uuid, node_type, identity + [ordinal])
        fact_node_ids[id(fact)] = node_id
        add_node(node_id, node_type, name, _attributes(fact, subtype), source_ref)
        kind = fact["kind"]
        file_id = file_ids[source_id]
        relation = (
            "imports" if kind == "import" else
            "depends_on" if kind == "dependency" else
            "declares" if node_type == "api" else
            "contains"
        )
        add_edge(file_id, node_id, relation, source_ref)
        if kind == "database_table":
            table_ids[(source_id, name)] = node_id

    for source_id, fact, source_ref, _, _, _, _ in recognized:
        if fact["kind"] == "database_column" and isinstance(fact.get("table"), str):
            table_id = table_ids.get((source_id, fact["table"]))
            if table_id:
                add_edge(table_id, fact_node_ids[id(fact)], "contains", source_ref)

    graph = {
        "schema_version": 1,
        "graph_version": GRAPH_VERSION,
        "project_id": project_id,
        "scope": scope,
        "generation_id": generation_id,
        "status": "complete" if scan_result.get("status") == "complete" and analysis.get("status") == "complete" else "partial",
        "coverage": {
            "source_count": len(sources),
            "analyzed_source_count": sum(status == "analyzed" for status in source_statuses.values()),
            "partial_source_count": sum(status == "partial" for status in source_statuses.values()),
            "failed_source_count": sum(status == "failed" for status in source_statuses.values()),
            "unsupported_source_count": sum(status == "unsupported" for status in source_statuses.values()),
            "scan_status": scan_result.get("status", "unknown"),
            "analysis_status": analysis.get("status", "unknown"),
            "limits_reached": bool(scan_result.get("limits_reached")),
            "chunker_version": scan_result.get("chunker_version"),
            "chunk_count": scan_result.get("chunk_count", 0),
            "chunk_content_bytes": scan_result.get("chunk_content_bytes", 0),
        },
        "node_count": len(nodes),
        "edge_count": len(edges),
        "nodes": sorted(nodes.values(), key=lambda item: item["id"]),
        "edges": sorted(
            ({**edge, "provenance": sorted(edge["provenance"], key=lambda item: (
                item["source_id"], item["line_start"] or 0, item["line_end"] or 0,
            ))} for edge in edges.values()),
            key=lambda item: item["id"],
        ),
    }
    return graph


def _validated_index(graph):
    if not isinstance(graph, dict) or graph.get("schema_version") != 1 or graph.get("graph_version") != GRAPH_VERSION:
        raise GraphQueryError("unsupported_graph_version")
    scope, generation_id = graph.get("scope"), graph.get("generation_id")
    if (not isinstance(scope, dict) or set(scope) != {"project_id"}
            or not isinstance(scope.get("project_id"), str) or not isinstance(generation_id, str)):
        raise GraphQueryError("invalid_graph_scope")
    try:
        valid_project = str(uuid.UUID(scope["project_id"])) == scope["project_id"]
        valid_generation = str(uuid.UUID(generation_id)) == generation_id
    except ValueError:
        valid_project = valid_generation = False
    if not valid_project or not valid_generation:
        raise GraphQueryError("invalid_graph_scope")
    nodes, edges = graph.get("nodes"), graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise GraphQueryError("invalid_graph_shape")
    if len(nodes) > MAX_GRAPH_NODES or len(edges) > MAX_GRAPH_EDGES:
        raise GraphQueryError("graph_size_limit")
    node_by_id = {}
    for node in nodes:
        if (not isinstance(node, dict) or not isinstance(node.get("id"), str)
                or node.get("id") in node_by_id or not isinstance(node.get("type"), str)
                or node.get("type") not in NODE_TYPES
                or node.get("scope") != scope or node.get("generation_id") != generation_id
                or not isinstance(node.get("name"), str) or len(node["name"]) > 1024
                or not isinstance(node.get("attributes"), dict)
                or not isinstance(node.get("provenance"), list)
                or not all(_valid_provenance(item) for item in node["provenance"])):
            raise GraphQueryError("invalid_graph_node")
        try:
            if str(uuid.UUID(node["id"])) != node["id"]:
                raise GraphQueryError("invalid_graph_node")
        except ValueError as error:
            raise GraphQueryError("invalid_graph_node") from error
        if node["type"] != "project" and not node["provenance"]:
            raise GraphQueryError("missing_graph_provenance")
        node_by_id[node["id"]] = node
    for edge in edges:
        if (not isinstance(edge, dict) or not isinstance(edge.get("source_id"), str)
                or not isinstance(edge.get("target_id"), str) or edge.get("scope") != scope
                or edge.get("generation_id") != generation_id
                or edge.get("source_id") not in node_by_id or edge.get("target_id") not in node_by_id
                or not isinstance(edge.get("relation"), str)
                or edge.get("relation") not in {"contains", "declares", "imports", "depends_on"}
                or not isinstance(edge.get("provenance"), list) or not edge["provenance"]
                or not all(_valid_provenance(item) for item in edge["provenance"])):
            raise GraphQueryError("invalid_graph_edge")
        try:
            if str(uuid.UUID(edge.get("id"))) != edge["id"]:
                raise GraphQueryError("invalid_graph_edge")
        except (ValueError, TypeError, AttributeError) as error:
            raise GraphQueryError("invalid_graph_edge") from error
    return node_by_id, edges


def find_nodes(graph, *, node_type=None, name=None, path=None, limit=50):
    """Return exact-match nodes. A selector and a response cap are mandatory."""
    node_by_id, _ = _validated_index(graph)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_QUERY_NODES:
        raise GraphQueryError("invalid_query_limit")
    if node_type is not None and (not isinstance(node_type, str) or node_type not in NODE_TYPES):
        raise GraphQueryError("invalid_node_type")
    if name is not None and (not isinstance(name, str) or not 1 <= len(name) <= 500):
        raise GraphQueryError("invalid_exact_name")
    if path is not None and (not isinstance(path, str) or not SAFE_RELATIVE_PATH.fullmatch(path)
                             or path.startswith("/") or any(part in {"", ".", ".."} for part in path.split("/"))):
        raise GraphQueryError("invalid_relative_path")
    if node_type is None and name is None and path is None:
        raise GraphQueryError("query_selector_required")
    matches = [
        node for node in node_by_id.values()
        if (node_type is None or node["type"] == node_type)
        and (name is None or node.get("name") == name)
        and (path is None or node.get("attributes", {}).get("path", node.get("name")) == path)
    ]
    matches.sort(key=lambda node: node["id"])
    return {"status": graph.get("status", "unknown"), "nodes": matches[:limit],
            "matched_count": len(matches), "returned_count": min(len(matches), limit),
            "truncated": len(matches) > limit}


def traverse_graph(graph, start_node_id, *, depth=1, limit=100, direction="both"):
    """Traverse bounded adjacency without crossing graph scope or generation."""
    node_by_id, edges = _validated_index(graph)
    if not isinstance(start_node_id, str) or start_node_id not in node_by_id:
        raise GraphQueryError("start_node_not_found")
    if not isinstance(depth, int) or isinstance(depth, bool) or not 0 <= depth <= MAX_TRAVERSAL_DEPTH:
        raise GraphQueryError("invalid_traversal_depth")
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_QUERY_NODES:
        raise GraphQueryError("invalid_query_limit")
    if not isinstance(direction, str) or direction not in {"out", "in", "both"}:
        raise GraphQueryError("invalid_traversal_direction")

    adjacency = defaultdict(list)
    for edge in edges:
        if direction in {"out", "both"}:
            adjacency[edge["source_id"]].append((edge["target_id"], edge))
        if direction in {"in", "both"}:
            adjacency[edge["target_id"]].append((edge["source_id"], edge))
    for neighbors in adjacency.values():
        neighbors.sort(key=lambda pair: (pair[0], pair[1]["id"]))

    visited = {start_node_id}
    selected_edges = {}
    queue = deque([(start_node_id, 0)])
    truncated = False
    while queue:
        current, current_depth = queue.popleft()
        if current_depth >= depth:
            continue
        for neighbor, edge in adjacency.get(current, []):
            if neighbor in visited:
                selected_edges[edge["id"]] = edge
                continue
            if len(visited) >= limit:
                truncated = True
                continue
            visited.add(neighbor)
            selected_edges[edge["id"]] = edge
            queue.append((neighbor, current_depth + 1))
    return {
        "status": graph.get("status", "unknown"),
        "nodes": [node_by_id[node_id] for node_id in sorted(visited)],
        "edges": [selected_edges[edge_id] for edge_id in sorted(selected_edges)],
        "truncated": truncated,
    }
