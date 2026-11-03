import json
import uuid

from analysis_worker import PARSE_DEADLINE_SECONDS, AnalyzerRunner
from scanner import scan

PROJECT = str(uuid.uuid4())


def fact_rows(result, kind):
    return [fact for fact in result["analysis"]["facts"] if fact["kind"] == kind]


def test_typescript_nest_routes_and_python_symbols_have_exact_source_ranges(tmp_path):
    (tmp_path / "users.controller.ts").write_text(
        'import { Controller, Get } from "@nestjs/common";\n'
        '@Controller("users")\n'
        "export class UsersController {\n"
        '  @Get(":id")\n'
        "  findOne() {}\n"
        "}\n"
    )
    (tmp_path / "service.py").write_text("class UserService:\n    def find(self, user_id):\n        return user_id\n")

    result = scan(tmp_path, PROJECT)
    route = fact_rows(result, "rest_route")[0]
    assert route["http_method"] == "GET"
    assert route["route"] == "/users/:id"
    assert route["adapter"] == "nestjs_decorator_syntax"
    assert route["line_start"] == 5 and route["line_end"] == 5
    assert any(fact.get("name") == "UsersController" for fact in fact_rows(result, "export"))
    assert {fact["name"] for fact in fact_rows(result, "decorator")} == {"Controller", "Get"}
    assert any(fact.get("name") == "UserService" for fact in fact_rows(result, "class"))
    assert any(fact.get("name") == "find" for fact in fact_rows(result, "function"))
    assert all(fact["content_hash"] for fact in result["analysis"]["facts"])
    for fact in result["analysis"]["facts"]:
        source = next(row for row in result["sources"] if row["source_id"] == fact["source_id"])
        assert 1 <= fact["line_start"] <= fact["line_end"] <= (source["line_end"] or 1)


def test_graphql_sql_openapi_dependencies_and_docs_are_structural(tmp_path):
    (tmp_path / "schema.graphql").write_text("type User { id: ID! }\ntype Query { user(id: ID!): User }\n")
    (tmp_path / "schema.sql").write_text("CREATE TABLE users (id uuid primary key, name text);\n")
    (tmp_path / "openapi.yaml").write_text(
        "openapi: 3.0.0\npaths:\n  /users:\n    get:\n      operationId: listUsers\n"
        "      responses:\n        '200':\n          description: ok\n"
        "components:\n  schemas:\n    User:\n      type: object\n"
    )
    (tmp_path / "package.json").write_text(
        '{\n  "dependencies": {\n    "fastify": "^5.0.0"\n  }\n}\n'
    )
    (tmp_path / "README.md").write_text("# Overview\n\n```md\n# Example in a code fence\n```\n## Install\n")

    result = scan(tmp_path, PROJECT)
    assert {row.get("name") for row in fact_rows(result, "graphql_type")} == {"User", "Query"}
    operation = fact_rows(result, "graphql_operation")[0]
    assert operation["operation_type"] == "query" and operation["name"] == "user"
    assert {row.get("name") for row in fact_rows(result, "database_table")} == {"users"}
    assert {row.get("name") for row in fact_rows(result, "database_column")} == {"id", "name"}
    api = fact_rows(result, "openapi_operation")[0]
    assert api["route"] == "/users" and api["http_method"] == "GET" and api["line_start"] == 4
    assert fact_rows(result, "openapi_schema")[0]["line_start"] == 11
    dependency = fact_rows(result, "dependency")[0]
    assert dependency["name"] == "fastify" and dependency["line_start"] == 3
    assert [fact["name"] for fact in fact_rows(result, "documentation_section")] == ["Overview", "Install"]
    assert result["analysis"]["facts_count"] == len(result["analysis"]["facts"])


def test_postgresql_grammar_extracts_real_migration_ddl(tmp_path):
    (tmp_path / "schema.sql").write_text(
        "CREATE TABLE app.users (id uuid PRIMARY KEY, email text NOT NULL);\n"
    )
    result = scan(tmp_path, PROJECT)
    assert {fact["name"] for fact in fact_rows(result, "database_table")} == {"app.users"}
    columns = fact_rows(result, "database_column")
    assert {(fact["name"], fact["data_type"]) for fact in columns} == {
        ("id", "uuid"), ("email", "text"),
    }
    assert result["analysis"]["files_failed"] == 0


def test_worker_timeout_isolated_and_next_file_recovers():
    runner = AnalyzerRunner(deadline_seconds=0.000001)
    try:
        timed_out = runner.analyze("slow.py", "slow-source", b"def slow():\n    return True\n")
        assert timed_out["status"] == "failed"
        assert timed_out["reason"] == "analyzer_timeout"

        runner._deadline_seconds = PARSE_DEADLINE_SECONDS
        recovered = runner.analyze("healthy.py", "healthy-source", b"def healthy():\n    return True\n")
        assert recovered["status"] == "analyzed"
        assert any(fact.get("name") == "healthy" for fact in recovered["facts"])
    finally:
        runner.close()


def test_nest_graphql_resolvers_are_inferred_only_from_framework_imports(tmp_path):
    (tmp_path / "users.resolver.ts").write_text(
        'import { Resolver, Query, Mutation } from "@nestjs/graphql";\n'
        "@Resolver()\nexport class UsersResolver {\n"
        "  @Query(() => [String])\n  findAll() {}\n"
        "  @Mutation(() => String)\n  create() {}\n}\n"
    )
    (tmp_path / "plain.ts").write_text("class Query { @Get() find() {} }\n")
    result = scan(tmp_path, PROJECT)
    facts = fact_rows(result, "graphql_resolver_operation")
    assert {(fact["operation_type"], fact["name"]) for fact in facts} == {("query", "findAll"), ("mutation", "create")}
    assert fact_rows(result, "rest_route") == []


def test_express_and_fastapi_route_syntax_is_detected_from_imported_frameworks(tmp_path):
    (tmp_path / "routes.ts").write_text(
        'import express from "express";\nconst app = express();\napp.get("/users", handler);\n'
    )
    (tmp_path / "routes.py").write_text(
        "from fastapi import FastAPI\napp = FastAPI()\n@app.post('/users')\ndef create_user():\n    pass\n"
    )
    result = scan(tmp_path, PROJECT)
    assert {(fact["http_method"], fact["route"], fact["adapter"]) for fact in fact_rows(result, "rest_route")} == {
        ("GET", "/users", "express_route_syntax"),
        ("POST", "/users", "fastapi_decorator_syntax"),
    }


def test_json_openapi_and_python_dependencies_use_exact_lines(tmp_path):
    (tmp_path / "openapi.json").write_text(
        '{\n"openapi":"3.0.0",\n"paths":{"/items":{"post":{"operationId":"createItem"}}},\n'
        '"components":{"schemas":{"Item":{"type":"object"}}}\n}\n'
    )
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "sample"\ndependencies = [\n  "fastapi>=0.115,<1",\n]\n'
    )
    result = scan(tmp_path, PROJECT)
    assert fact_rows(result, "openapi_operation")[0]["line_start"] == 3
    assert fact_rows(result, "openapi_schema")[0]["line_start"] == 4
    assert fact_rows(result, "dependency")[0]["line_start"] == 4


def test_parser_failure_is_isolated_and_yaml_aliases_rejected(tmp_path):
    (tmp_path / "valid.py").write_text("def healthy():\n    return True\n")
    (tmp_path / "broken.ts").write_text("export class Broken {\n")
    (tmp_path / "openapi.yaml").write_text("openapi: 3.0.0\npaths: &paths {}\nother: *paths\n")

    result = scan(tmp_path, PROJECT)
    assert result["status"] == "partial"
    assert {fact.get("name") for fact in fact_rows(result, "function")} == {"healthy"}
    assert {row["reason"] for row in result["analysis"]["failures"]} == {"invalid_or_unsupported_syntax"}
    assert {row["path"] for row in result["analysis"]["failures"]} == {"broken.ts", "openapi.yaml"}


def test_duplicate_yaml_keys_are_rejected_without_resolving_external_refs(tmp_path):
    (tmp_path / "openapi.yaml").write_text(
        "openapi: 3.0.0\npaths:\n  /items:\n    get:\n      operationId: listItems\n"
        "  /items:\n    post:\n      operationId: createItem\n"
        "components:\n  schemas:\n    Item:\n      $ref: https://invalid.example/schema.json\n"
    )
    result = scan(tmp_path, PROJECT)
    assert result["status"] == "partial"
    assert result["analysis"]["facts"] == []
    assert result["analysis"]["failures"][0]["reason"] == "invalid_or_unsupported_syntax"


def test_source_is_parsed_as_data_and_never_executed(tmp_path, monkeypatch):
    marker = tmp_path / "executed"
    monkeypatch.chdir(tmp_path)
    source = "from pathlib import Path\nPath('executed').write_text('ran')\nclass Safe:\n    pass\n"
    (tmp_path / "source.py").write_text(source)
    result = scan(tmp_path, PROJECT)
    assert not marker.exists()
    assert any(fact.get("name") == "Safe" for fact in fact_rows(result, "class"))
    assert "write_text" not in json.dumps(result["analysis"])


def test_manifest_failure_and_unsupported_file_counts_are_explicit(tmp_path):
    (tmp_path / "openapi.json").write_text('{"openapi":"3.0.0","paths": {"/x": {"get": {}}}, "paths": {}}')
    (tmp_path / "schema.avsc").write_text('{"type":"record","name":"User"}')
    result = scan(tmp_path, PROJECT)
    assert result["status"] == "partial"
    assert result["analysis"]["files_failed"] == 1
    assert result["analysis"]["files_unsupported"] == 1
    assert result["analysis"]["failures"][0]["path"] == "openapi.json"


def test_per_file_fact_limit_discards_that_files_partial_facts(tmp_path):
    (tmp_path / "large.md").write_text("# Section\n" * 5_001)
    (tmp_path / "valid.py").write_text("def valid():\n    return True\n")
    result = scan(tmp_path, PROJECT)
    assert result["status"] == "partial"
    assert result["analysis"]["failures"][0]["path"] == "large.md"
    assert not any(fact["path"] == "large.md" for fact in result["analysis"]["facts"])
    assert any(fact.get("name") == "valid" for fact in fact_rows(result, "function"))


def test_restructuredtext_headings_are_emitted_with_line_ranges(tmp_path):
    (tmp_path / "guide.rst").write_text("Overview\n========\n\nDetails\n-------\n")
    result = scan(tmp_path, PROJECT)
    assert [(fact["name"], fact["line_start"]) for fact in fact_rows(result, "documentation_section")] == [
        ("Overview", 1), ("Details", 4),
    ]
