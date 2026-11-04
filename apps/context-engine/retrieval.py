"""Scoped, read-only retrieval over a published local context graph."""
from storage import RUNTIME_ROLE, StorageError, parse_scope_uuid, set_context_scope

MAX_QUERY_CHARS = 200
MAX_RESULTS = 20
MAX_NEIGHBORS_PER_RESULT = 5


def _escape_like(value):
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_published_graph(*, database_url, tenant_id, project_id, environment_id, query, limit=10):
    """Search current-generation graph facts; this is lexical/structural, not semantic retrieval."""
    scope = (
        parse_scope_uuid(tenant_id, "tenant_id"),
        parse_scope_uuid(project_id, "project_id"),
        parse_scope_uuid(environment_id, "environment_id"),
    )
    if not isinstance(query, str) or not 2 <= len(query.strip()) <= MAX_QUERY_CHARS:
        raise ValueError("query_must_contain_2_to_200_characters")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_RESULTS:
        raise ValueError("limit_must_be_between_1_and_20")
    if not database_url:
        raise ValueError("DATABASE_URL_required")

    import psycopg

    try:
        with psycopg.connect(database_url, connect_timeout=5) as connection:
            connection.execute(f"SET ROLE {RUNTIME_ROLE}")
            connection.commit()
            with connection.transaction():
                # Pin the head, graph rows, and edges to one snapshot if rollback/deletion races this read.
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                set_context_scope(connection, scope)
                head = connection.execute(
                    """SELECT h.generation_id, g.graph_version, g.status
                       FROM context_platform.graph_heads h
                       JOIN context_platform.graph_generations g
                         USING (tenant_id, project_id, environment_id, generation_id)
                       WHERE h.tenant_id=%s AND h.project_id=%s AND h.environment_id=%s
                         AND g.state='published'""",
                    scope,
                ).fetchone()
                if head is None:
                    return {"status": "no_published_generation", "results": []}

                needle = _escape_like(query.strip())
                rows = connection.execute(
                    """SELECT node_id, node_type, name, attributes, provenance,
                              CASE
                                WHEN lower(name)=lower(%s) THEN 'exact_name'
                                WHEN name ILIKE %s ESCAPE E'\\' THEN 'name_prefix'
                                WHEN name ILIKE %s ESCAPE E'\\' THEN 'name_substring'
                                ELSE 'attribute_substring'
                              END AS match_kind
                       FROM context_platform.graph_nodes
                       WHERE tenant_id=%s AND project_id=%s AND environment_id=%s
                         AND generation_id=%s
                         AND (name ILIKE %s ESCAPE E'\\' OR attributes::text ILIKE %s ESCAPE E'\\')
                       ORDER BY CASE
                                  WHEN lower(name)=lower(%s) THEN 0
                                  WHEN name ILIKE %s ESCAPE E'\\' THEN 1
                                  WHEN name ILIKE %s ESCAPE E'\\' THEN 2
                                  ELSE 3
                                END, lower(name), node_id
                       LIMIT %s""",
                    [query.strip(), needle + "%", "%" + needle + "%",
                     *scope, head[0], "%" + needle + "%", "%" + needle + "%",
                     query.strip(), needle + "%", "%" + needle + "%", limit],
                ).fetchall()

                result_ids = [row[0] for row in rows]
                neighbors = {}
                if result_ids:
                    edge_rows = connection.execute(
                        """SELECT e.source_node_id, e.target_node_id, e.relation,
                                  source.name, source.node_type, source.provenance,
                                  target.name, target.node_type, target.provenance
                           FROM context_platform.graph_edges e
                           JOIN context_platform.graph_nodes source
                             ON source.tenant_id=e.tenant_id AND source.project_id=e.project_id
                            AND source.environment_id=e.environment_id AND source.generation_id=e.generation_id
                            AND source.node_id=e.source_node_id
                           JOIN context_platform.graph_nodes target
                             ON target.tenant_id=e.tenant_id AND target.project_id=e.project_id
                            AND target.environment_id=e.environment_id AND target.generation_id=e.generation_id
                            AND target.node_id=e.target_node_id
                           WHERE e.tenant_id=%s AND e.project_id=%s AND e.environment_id=%s
                             AND e.generation_id=%s AND (e.source_node_id=ANY(%s) OR e.target_node_id=ANY(%s))
                           ORDER BY e.relation, e.edge_id
                           LIMIT %s""",
                        [*scope, head[0], result_ids, result_ids, limit * MAX_NEIGHBORS_PER_RESULT * 2],
                    ).fetchall()

                    for edge in edge_rows:
                        for result_id, neighbor_id, direction, name, node_type, provenance in (
                            (edge[0], edge[1], "out", edge[6], edge[7], edge[8]),
                            (edge[1], edge[0], "in", edge[3], edge[4], edge[5]),
                        ):
                            if result_id not in result_ids:
                                continue
                            bucket = neighbors.setdefault(result_id, [])
                            if neighbor_id == result_id or len(bucket) >= MAX_NEIGHBORS_PER_RESULT:
                                continue
                            bucket.append({
                                "direction": direction,
                                "relation": edge[2],
                                "node_id": str(neighbor_id),
                                "node_type": node_type,
                                "name": name,
                                "provenance": provenance,
                            })

                chunk_rows = connection.execute(
                    """SELECT chunk_id, source_id, chunk_index, relative_path, content,
                              content_sha256, line_start, line_end,
                              ts_rank_cd(to_tsvector('simple', content), plainto_tsquery('simple', %s)) AS lexical_weight
                       FROM context_platform.context_chunks
                       WHERE tenant_id=%s AND project_id=%s AND environment_id=%s
                         AND generation_id=%s
                         AND (to_tsvector('simple', content) @@ plainto_tsquery('simple', %s)
                              OR content ILIKE %s ESCAPE E'\\')
                       ORDER BY lexical_weight DESC, relative_path, line_start, chunk_index
                       LIMIT %s""",
                    [query.strip(), *scope, head[0], query.strip(), "%" + needle + "%", limit],
                ).fetchall()

                return {
                    "status": "ok",
                    "retrieval_mode": "lexical_graph",
                    "generation_id": str(head[0]),
                    "graph_version": head[1],
                    "coverage_status": head[2],
                    "results": [
                        {
                            "node_id": str(row[0]),
                            "node_type": row[1],
                            "name": row[2],
                            "attributes": row[3],
                            "provenance": row[4],
                            "rank": rank,
                            "match_kind": row[5],
                            "neighbors": neighbors.get(row[0], []),
                        }
                        for rank, row in enumerate(rows, start=1)
                    ],
                    "chunks": [
                        {
                            "chunk_id": str(row[0]),
                            "source_id": str(row[1]),
                            "chunk_index": row[2],
                            "path": row[3],
                            "content": row[4],
                            "content_sha256": row[5].strip(),
                            "line_start": row[6],
                            "line_end": row[7],
                            "rank": rank,
                            "match_kind": "lexical_chunk",
                        }
                        for rank, row in enumerate(chunk_rows, start=1)
                    ],
                    "semantic_search": "not_implemented",
                    "source_text": "retrieved_as_bounded_chunks_from_secret_screened_files",
                }
    except (psycopg.Error, OSError) as error:
        raise StorageError("PostgreSQL context retrieval failed.") from error

