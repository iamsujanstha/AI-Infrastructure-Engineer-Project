"""Checkpointed PostgreSQL persistence for immutable project graph generations."""
import hashlib
import json
import time
import uuid

from graph import _validated_index

RUNTIME_ROLE = "context_runtime"
BATCH_SIZE = 500
LOCK_WAIT_SECONDS = 30
MAX_STORED_CHUNKS = 20_000
MAX_CHUNK_CHARS = 4_000


class StorageError(RuntimeError):
    """A safe-to-report PostgreSQL storage failure."""


class InjectedIndexInterruption(RuntimeError):
    """Deliberately stop after a committed batch to exercise resume behavior."""


def parse_scope_uuid(value, field):
    try:
        parsed = uuid.UUID(value)
    except (ValueError, TypeError, AttributeError) as error:
        raise ValueError(f"invalid_{field}") from error
    if str(parsed) != value:
        raise ValueError(f"invalid_{field}")
    return parsed


def _canonical_hash(value):
    canonical = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


def _validated_chunks(chunks, graph):
    if not isinstance(chunks, list) or len(chunks) > MAX_STORED_CHUNKS:
        raise ValueError("invalid_context_chunks")
    project_id = parse_scope_uuid(graph.get("project_id"), "project_id")
    chunker_version = graph.get("chunker_version")
    if not isinstance(chunker_version, str) or not chunker_version:
        if chunks:
            raise ValueError("chunker_version_missing")
        return []

    sources = {}
    for node in graph.get("nodes", []):
        if node.get("type") != "file":
            continue
        for reference in node.get("provenance", []):
            source_id = reference.get("source_id")
            sources[source_id] = {
                "path": reference.get("path"),
                "content_hash": reference.get("content_hash"),
                "line_end": reference.get("line_end"),
            }

    from scanner import findings

    seen_ids, seen_indexes, validated, total_bytes = set(), set(), [], 0
    namespace = project_id
    for chunk in chunks:
        if not isinstance(chunk, dict):
            raise ValueError("invalid_context_chunk")
        source_id = parse_scope_uuid(chunk.get("source_id"), "chunk_source_id")
        catalog = sources.get(str(source_id))
        content = chunk.get("content")
        if not catalog or not isinstance(content, str) or not content.strip() or len(content) > MAX_CHUNK_CHARS:
            raise ValueError("invalid_context_chunk")
        encoded = content.encode("utf-8")
        total_bytes += len(encoded)
        if len(encoded) > MAX_CHUNK_CHARS * 4 or total_bytes > 16 * 1024 * 1024:
            raise ValueError("context_chunk_byte_limit")
        if findings(content):
            raise ValueError("sensitive_context_chunk_rejected")
        chunk_index, line_start, line_end = chunk.get("chunk_index"), chunk.get("line_start"), chunk.get("line_end")
        if (isinstance(chunk_index, bool) or not isinstance(chunk_index, int) or chunk_index < 0
                or isinstance(line_start, bool) or not isinstance(line_start, int) or line_start < 1
                or isinstance(line_end, bool) or not isinstance(line_end, int) or line_end < line_start
                or isinstance(catalog["line_end"], int) and line_end > catalog["line_end"]):
            raise ValueError("invalid_context_chunk_range")
        if (chunk.get("path") != catalog["path"]
                or chunk.get("source_content_hash") != catalog["content_hash"]
                or chunk.get("chunker_version") != chunker_version):
            raise ValueError("context_chunk_source_mismatch")
        content_hash = hashlib.sha256(encoded).hexdigest()
        if chunk.get("chunk_content_hash") != content_hash:
            raise ValueError("context_chunk_hash_mismatch")
        chunk_id = str(uuid.uuid5(
            namespace,
            f"context-chunk:{chunker_version}:{source_id}:{chunk_index}:{content_hash}",
        ))
        if chunk.get("chunk_id") != chunk_id:
            raise ValueError("context_chunk_id_mismatch")
        index_key = (source_id, chunk_index)
        if chunk_id in seen_ids or index_key in seen_indexes:
            raise ValueError("duplicate_context_chunk")
        seen_ids.add(chunk_id)
        seen_indexes.add(index_key)
        validated.append({
            "chunk_id": chunk_id,
            "source_id": str(source_id),
            "chunk_index": chunk_index,
            "path": catalog["path"],
            "content": content,
            "content_sha256": content_hash,
            "line_start": line_start,
            "line_end": line_end,
            "chunker_version": chunker_version,
        })
    return validated


def _batches(values):
    for offset in range(0, len(values), BATCH_SIZE):
        yield offset // BATCH_SIZE, values[offset:offset + BATCH_SIZE]


def set_context_scope(connection, scope):
    connection.execute(
        "SELECT set_config('context.tenant_id', %s, true), set_config('context.project_id', %s, true), set_config('context.environment_id', %s, true)",
        [str(scope[0]), str(scope[1]), str(scope[2])],
    )


def _checkpoint(connection, scope, generation, key, payload_hash, rows):
    found = connection.execute(
        "SELECT payload_hash, row_count FROM context_platform.index_checkpoints WHERE tenant_id=%s AND project_id=%s AND environment_id=%s AND generation_id=%s AND checkpoint_key=%s",
        [*scope, generation, key],
    ).fetchone()
    if found:
        if found[0].strip() != payload_hash or found[1] != len(rows):
            raise StorageError("An existing indexing checkpoint does not match this artifact.")
        return True
    return False


def _verify_row_counts(connection, scope, generation, expected):
    for table, count in expected.items():
        actual = connection.execute(
            f"SELECT count(*) FROM context_platform.{table} WHERE tenant_id=%s AND project_id=%s AND environment_id=%s AND generation_id=%s",
            [*scope, generation],
        ).fetchone()[0]
        if actual != count:
            raise StorageError(f"Stored {table} count does not match the published manifest.")


def _save_stage(connection, scope, generation, stage, items, insert_sql, row_builder, jsonb_factory, progress, interrupt_after_checkpoints):
    for batch_number, batch in _batches(items):
        checkpoint_key = f"{stage}:{batch_number:08d}"
        payload_hash = _canonical_hash(batch)
        with connection.transaction():
            set_context_scope(connection, scope)
            if _checkpoint(connection, scope, generation, checkpoint_key, payload_hash, batch):
                continue
            with connection.cursor() as cursor:
                cursor.executemany(insert_sql, [row_builder(item, jsonb_factory) for item in batch])
            connection.execute(
                "INSERT INTO context_platform.index_checkpoints (tenant_id,project_id,environment_id,generation_id,checkpoint_key,payload_hash,row_count) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                [*scope, generation, checkpoint_key, payload_hash, len(batch)],
            )
        progress[0] += 1
        if interrupt_after_checkpoints == progress[0]:
            raise InjectedIndexInterruption("Index interrupted after a durable checkpoint; rerun the same artifact to resume.")


def persist_graph(graph, *, chunks=None, database_url, tenant_id, environment_id, environment_name="local", interrupt_after_checkpoints=None):
    """Resume validated graph/source chunks and atomically publish one immutable generation."""
    tenant = parse_scope_uuid(tenant_id, "tenant_id")
    project = parse_scope_uuid(graph.get("project_id"), "project_id")
    environment = parse_scope_uuid(environment_id, "environment_id")
    generation = parse_scope_uuid(graph.get("generation_id"), "generation_id")
    nodes_by_id, edges = _validated_index(graph)
    nodes = [nodes_by_id[key] for key in sorted(nodes_by_id)]
    chunk_records = _validated_chunks([] if chunks is None else chunks, graph)
    if not database_url:
        raise ValueError("DATABASE_URL_required")
    if not isinstance(environment_name, str) or not 1 <= len(environment_name) <= 80:
        raise ValueError("invalid_environment_name")
    if interrupt_after_checkpoints is not None and (isinstance(interrupt_after_checkpoints, bool)
            or not isinstance(interrupt_after_checkpoints, int) or not 1 <= interrupt_after_checkpoints <= 10):
        raise ValueError("invalid_failure_injection_limit")

    scope = (tenant, project, environment)
    manifest_hash = _canonical_hash({"graph": graph, "chunks": chunk_records})
    source_records = {}
    for node in nodes:
        if node["type"] == "file":
            for reference in node["provenance"]:
                source_records[reference["source_id"]] = (
                    reference["path"], reference["content_hash"],
                    node["attributes"].get("analysis_status", "unsupported"),
                )
    sources = sorted(source_records.items())

    import psycopg
    from psycopg.types.json import Jsonb

    connection = None
    lock_key = "/".join(map(str, scope))
    lock_acquired = False
    try:
        connection = psycopg.connect(database_url, connect_timeout=5)
        connection.execute(f"SET ROLE {RUNTIME_ROLE}")
        connection.commit()
        deadline = time.monotonic() + LOCK_WAIT_SECONDS
        while time.monotonic() < deadline:
            locked = connection.execute(
                "SELECT pg_try_advisory_lock(hashtextextended(%s, 0)) AS locked", [lock_key]
            ).fetchone()[0]
            connection.commit()
            if locked:
                lock_acquired = True
                break
            time.sleep(0.1)
        if not lock_acquired:
            raise StorageError("Another index operation holds this project environment lock.")

        with connection.transaction():
            set_context_scope(connection, scope)
            connection.execute(
                "INSERT INTO context_platform.projects (tenant_id,project_id,name) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                [tenant, project, f"Project {str(project)[:8]}"])
            connection.execute(
                "INSERT INTO context_platform.environments (tenant_id,project_id,environment_id,name) VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                [tenant, project, environment, environment_name])
            existing = connection.execute(
                "SELECT generation_id,state FROM context_platform.graph_generations WHERE tenant_id=%s AND project_id=%s AND environment_id=%s AND manifest_hash=%s",
                [*scope, manifest_hash],
            ).fetchone()
            if existing and existing[1] == "published":
                generation = existing[0]
                _verify_row_counts(connection, scope, generation, {
                    "graph_sources": len(sources), "graph_nodes": len(nodes), "graph_edges": len(edges),
                    "context_chunks": len(chunk_records),
                })
                connection.execute(
                    "INSERT INTO context_platform.graph_heads (tenant_id,project_id,environment_id,generation_id) VALUES (%s,%s,%s,%s) ON CONFLICT (tenant_id,project_id,environment_id) DO UPDATE SET generation_id=EXCLUDED.generation_id,updated_at=clock_timestamp()",
                    [*scope, generation],
                )
                return _result("already_published", scope, generation, nodes, edges, chunk_records, manifest_hash)
            if existing:
                generation = existing[0]
            else:
                conflicting_generation = connection.execute(
                    "SELECT manifest_hash FROM context_platform.graph_generations WHERE tenant_id=%s AND project_id=%s AND environment_id=%s AND generation_id=%s",
                    [*scope, generation],
                ).fetchone()
                if conflicting_generation:
                    raise StorageError("This graph generation ID already exists with a different source/chunk manifest; rescan the project.")
                connection.execute(
                    "INSERT INTO context_platform.graph_generations (tenant_id,project_id,environment_id,generation_id,graph_version,manifest_hash,status,state,node_count,edge_count,coverage) VALUES (%s,%s,%s,%s,%s,%s,%s,'building',%s,%s,%s)",
                    [*scope, generation, graph["graph_version"], manifest_hash, graph["status"], len(nodes), len(edges), Jsonb(graph["coverage"])],
                )

        progress = [0]

        _save_stage(
            connection, scope, generation, "sources", sources,
            "INSERT INTO context_platform.graph_sources (tenant_id,project_id,environment_id,generation_id,source_id,relative_path,content_hash,analysis_status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            lambda item, _jsonb: (*scope, generation, parse_scope_uuid(item[0], "source_id"), *item[1]), Jsonb, progress, interrupt_after_checkpoints,
        )
        _save_stage(
            connection, scope, generation, "chunks", chunk_records,
            "INSERT INTO context_platform.context_chunks (tenant_id,project_id,environment_id,generation_id,chunk_id,source_id,chunk_index,relative_path,content,content_sha256,line_start,line_end,chunker_version) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            lambda chunk, _jsonb: (*scope, generation, chunk["chunk_id"], chunk["source_id"], chunk["chunk_index"], chunk["path"], chunk["content"], chunk["content_sha256"], chunk["line_start"], chunk["line_end"], chunk["chunker_version"]), Jsonb, progress, interrupt_after_checkpoints,
        )
        _save_stage(
            connection, scope, generation, "nodes", nodes,
            "INSERT INTO context_platform.graph_nodes (tenant_id,project_id,environment_id,generation_id,node_id,node_type,name,attributes,provenance) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            lambda node, jsonb: (*scope, generation, parse_scope_uuid(node["id"], "node_id"), node["type"], node["name"], jsonb(node["attributes"]), jsonb(node["provenance"])), Jsonb, progress, interrupt_after_checkpoints,
        )
        _save_stage(
            connection, scope, generation, "edges", edges,
            "INSERT INTO context_platform.graph_edges (tenant_id,project_id,environment_id,generation_id,edge_id,source_node_id,target_node_id,relation,provenance) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            lambda edge, jsonb: (*scope, generation, parse_scope_uuid(edge["id"], "edge_id"), parse_scope_uuid(edge["source_id"], "source_node_id"), parse_scope_uuid(edge["target_id"], "target_node_id"), edge["relation"], jsonb(edge["provenance"])), Jsonb, progress, interrupt_after_checkpoints,
        )

        with connection.transaction():
            set_context_scope(connection, scope)
            _verify_row_counts(connection, scope, generation, {
                "graph_sources": len(sources), "graph_nodes": len(nodes), "graph_edges": len(edges),
                "context_chunks": len(chunk_records),
            })
            connection.execute(
                "UPDATE context_platform.graph_generations SET state='published',published_at=clock_timestamp() WHERE tenant_id=%s AND project_id=%s AND environment_id=%s AND generation_id=%s AND state='building'",
                [*scope, generation],
            )
            connection.execute(
                "INSERT INTO context_platform.graph_heads (tenant_id,project_id,environment_id,generation_id) VALUES (%s,%s,%s,%s) ON CONFLICT (tenant_id,project_id,environment_id) DO UPDATE SET generation_id=EXCLUDED.generation_id,updated_at=clock_timestamp()",
                [*scope, generation],
            )
        return _result("published", scope, generation, nodes, edges, chunk_records, manifest_hash)
    except psycopg.Error as error:
        raise StorageError("PostgreSQL graph persistence failed; published data remains unchanged.") from error
    finally:
        if connection is not None:
            if lock_acquired:
                try:
                    connection.execute("SELECT pg_advisory_unlock(hashtextextended(%s, 0))", [lock_key])
                    connection.commit()
                except psycopg.Error:
                    connection.rollback()
            connection.close()


def _result(status, scope, generation, nodes, edges, chunks, manifest_hash):
    return {
        "status": status,
        "tenant_id": str(scope[0]),
        "project_id": str(scope[1]),
        "environment_id": str(scope[2]),
        "generation_id": str(generation),
        "node_count": len(nodes),
        "edge_count": len(edges),
        "chunk_count": len(chunks),
        "manifest_hash": manifest_hash,
    }


def rollback_generation(*, database_url, tenant_id, project_id, environment_id, generation_id):
    """Atomically repoint the current head to an already published generation."""
    tenant, project, environment, generation = (
        parse_scope_uuid(tenant_id, "tenant_id"), parse_scope_uuid(project_id, "project_id"),
        parse_scope_uuid(environment_id, "environment_id"), parse_scope_uuid(generation_id, "generation_id"),
    )
    return _change_head(database_url, (tenant, project, environment), generation)


def delete_environment(*, database_url, tenant_id, project_id, environment_id, confirmation):
    """Delete all generations/checkpoints in one environment after an exact UUID confirmation."""
    tenant, project, environment = (
        parse_scope_uuid(tenant_id, "tenant_id"), parse_scope_uuid(project_id, "project_id"), parse_scope_uuid(environment_id, "environment_id"),
    )
    if confirmation != str(environment):
        raise ValueError("environment_confirmation_mismatch")
    if not database_url:
        raise ValueError("DATABASE_URL_required")
    import psycopg
    try:
        with psycopg.connect(database_url, connect_timeout=5) as connection:
            connection.execute(f"SET ROLE {RUNTIME_ROLE}")
            with connection.transaction():
                set_context_scope(connection, (tenant, project, environment))
                connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", ["/".join(map(str, (tenant, project, environment)))])
                deleted = connection.execute(
                    "DELETE FROM context_platform.environments WHERE tenant_id=%s AND project_id=%s AND environment_id=%s RETURNING environment_id",
                    [tenant, project, environment],
                ).fetchone()
        return {"status": "deleted" if deleted else "not_found", "project_id": str(project), "environment_id": str(environment)}
    except psycopg.Error as error:
        raise StorageError("PostgreSQL environment deletion failed; the transaction was rolled back.") from error


def _change_head(database_url, scope, generation):
    if not database_url:
        raise ValueError("DATABASE_URL_required")
    import psycopg
    try:
        with psycopg.connect(database_url, connect_timeout=5) as connection:
            connection.execute(f"SET ROLE {RUNTIME_ROLE}")
            with connection.transaction():
                set_context_scope(connection, scope)
                connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", ["/".join(map(str, scope))])
                selected = connection.execute(
                    "SELECT state FROM context_platform.graph_generations WHERE tenant_id=%s AND project_id=%s AND environment_id=%s AND generation_id=%s FOR SHARE",
                    [*scope, generation],
                ).fetchone()
                if not selected or selected[0] != "published":
                    raise ValueError("published_generation_not_found")
                connection.execute(
                    "INSERT INTO context_platform.graph_heads (tenant_id,project_id,environment_id,generation_id) VALUES (%s,%s,%s,%s) ON CONFLICT (tenant_id,project_id,environment_id) DO UPDATE SET generation_id=EXCLUDED.generation_id,updated_at=clock_timestamp()",
                    [*scope, generation],
                )
        return {"status": "head_updated", "generation_id": str(generation), "project_id": str(scope[1]), "environment_id": str(scope[2])}
    except psycopg.Error as error:
        raise StorageError("PostgreSQL generation rollback failed; the head was not changed.") from error
