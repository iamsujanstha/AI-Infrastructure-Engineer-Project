"""Bounded, non-executing source adapters for the local project analyzer."""
import json
import re
import time
import tomllib
from functools import lru_cache
from pathlib import Path

import tree_sitter_graphql
import tree_sitter_javascript
import tree_sitter_json
import tree_sitter_postgres
import tree_sitter_python
import tree_sitter_typescript
import tree_sitter_yaml
import yaml
from tree_sitter import Language, Parser
from yaml.events import AliasEvent

VERSION = "1"
MAX_YAML_NODES = 100_000
MAX_YAML_DEPTH = 64
MAX_FILE_FACTS = 5_000
MAX_JSON_KEYS = 100_000
SYMBOLS = {
    "class_declaration": "class", "class_definition": "class",
    "function_declaration": "function", "function_definition": "function",
    "method_definition": "method", "interface_declaration": "interface",
    "type_alias_declaration": "type", "enum_declaration": "enum",
    "object_type_definition": "graphql_type", "interface_type_definition": "graphql_interface",
    "input_object_type_definition": "graphql_input", "enum_type_definition": "graphql_enum",
    "union_type_definition": "graphql_union", "scalar_type_definition": "graphql_scalar",
    "field_definition": "graphql_field",
}
HTTP_DECORATORS = {"Get": "GET", "Post": "POST", "Put": "PUT", "Patch": "PATCH", "Delete": "DELETE", "Options": "OPTIONS", "Head": "HEAD", "All": "ALL"}
GRAPHQL_DECORATORS = {"Query": "query", "Mutation": "mutation", "Subscription": "subscription"}
HTTP_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
SAFE_DEP_SPEC = re.compile(r"^[A-Za-z0-9*^~<>=!.,|+ _-]{1,120}$")
PY_REQUIREMENT = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)(?:\[[A-Za-z0-9_,.-]+\])?\s*(.*)$")


class AnalyzerInputError(ValueError):
    """A sanitized parser failure category, never an exception string."""


class StrictYamlLoader(yaml.SafeLoader):
    """Safe YAML subset: aliases, duplicate keys and excessive structure are rejected."""

    def __init__(self, stream):
        super().__init__(stream)
        self.node_count = 0
        self.nesting = 0

    def compose_node(self, parent, index):
        if self.check_event(AliasEvent):
            raise AnalyzerInputError("yaml_alias_unsupported")
        self.node_count += 1
        self.nesting += 1
        try:
            if self.node_count > MAX_YAML_NODES or self.nesting > MAX_YAML_DEPTH:
                raise AnalyzerInputError("yaml_structure_limit")
            return super().compose_node(parent, index)
        finally:
            self.nesting -= 1

    def construct_mapping(self, node, deep=False):
        mapping = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if key in mapping:
                raise AnalyzerInputError("yaml_duplicate_key")
            mapping[key] = self.construct_object(value_node, deep=deep)
        return mapping


@lru_cache(maxsize=8)
def _language(language):
    factories = {
        "python": tree_sitter_python.language,
        "javascript": tree_sitter_javascript.language,
        "typescript": tree_sitter_typescript.language_typescript,
        "tsx": tree_sitter_typescript.language_tsx,
        "graphql": tree_sitter_graphql.language,
        "sql": tree_sitter_postgres.language,
        "yaml": tree_sitter_yaml.language,
        "json": tree_sitter_json.language,
    }
    return Language(factories[language]())


def _parser(language):
    return Parser(_language(language))


def _json_lines(raw):
    tree = _parser("json").parse(raw)
    if tree.root_node.has_error:
        raise AnalyzerInputError("invalid_json_document")
    locations = {}
    stack = [(tree.root_node, ())]
    while stack:
        node, parent = stack.pop()
        if node.type != "object":
            stack.extend((child, parent) for child in node.named_children)
            continue
        for pair in node.named_children:
            if pair.type != "pair":
                continue
            key_node = pair.child_by_field_name("key")
            value_node = pair.child_by_field_name("value")
            if key_node is None or value_node is None:
                continue
            key = json.loads(_text(key_node, raw))
            if isinstance(key, str):
                path = parent + (key,)
                # Duplicate JSON keys make the interpreted document ambiguous.
                if path in locations:
                    raise AnalyzerInputError("duplicate_json_key")
                if len(locations) >= MAX_JSON_KEYS:
                    raise AnalyzerInputError("json_structure_limit")
                locations[path] = key_node.start_point.row + 1
                stack.append((value_node, path))
    return locations


def _text(node, raw):
    return raw[node.start_byte:node.end_byte].decode("utf-8", errors="strict")


def _name(node, raw):
    name_node = node.child_by_field_name("name")
    if name_node is None:
        name_node = next((child for child in node.named_children if child.type in {"name", "identifier", "type_identifier", "property_identifier"}), None)
    if name_node is None:
        return None
    value = _text(name_node, raw).strip()
    return value if len(value) <= 200 and not _sensitive_name(value) else None


def _sensitive_name(value):
    return bool(re.search(r"(?i)(?:api[_-]?key|access[_-]?token|password|passwd|secret|private[_-]?key)", value))


def _fact(kind, path, source_id, node, name=None, **extra):
    fact = {"kind": kind, "path": path, "source_id": source_id,
            "line_start": node.start_point.row + 1, "line_end": node.end_point.row + 1,
            "evidence": "syntax"}
    if name is not None:
        fact["name"] = name
    fact.update(extra)
    return fact


def _line_fact(kind, path, source_id, line, name=None, **extra):
    fact = {"kind": kind, "path": path, "source_id": source_id,
            "line_start": line, "line_end": line, "evidence": "manifest"}
    if name is not None:
        fact["name"] = name
    fact.update(extra)
    return fact


def _append_fact(facts, fact):
    if len(facts) >= MAX_FILE_FACTS:
        raise AnalyzerInputError("fact_limit")
    facts.append(fact)


def _walk(root):
    stack = [root]
    while stack:
        node = stack.pop()
        yield node
        stack.extend(reversed(node.named_children))


def _literal_decorator(decorator_text):
    value = decorator_text.strip()
    name = r"@([A-Za-z_$][\w$]*)"
    empty = re.fullmatch(name + r"\s*(?:\(\s*\))?", value)
    if empty:
        return empty.group(1), ""
    literal = re.fullmatch(name + r"\s*\(\s*(['\"])([^'\"\\\r\n]{0,200})\2\s*(?:,.*)?\)", value)
    return (literal.group(1), literal.group(3)) if literal else None


def _ancestors(node):
    current = node.parent
    while current is not None:
        yield current
        current = current.parent


def _direct_decorators(node, raw):
    return [_text(child, raw) for child in node.named_children if child.type == "decorator"]


def _preceding_decorators(node, raw):
    if node.parent is None:
        return []
    siblings = node.parent.named_children
    index = next((i for i, sibling in enumerate(siblings)
                  if sibling.start_byte == node.start_byte and sibling.type == node.type), -1)
    result = []
    while index > 0 and siblings[index - 1].type == "decorator":
        result.append(_text(siblings[index - 1], raw))
        index -= 1
    return list(reversed(result))


def _literal_string(node, raw):
    if node is None or node.type != "string":
        return None
    value = _text(node, raw)
    if len(value) < 2 or value[0] not in "'\"" or value[-1] != value[0] or "\\" in value:
        return None
    return value[1:-1]


def _extract_syntax(path, source_id, raw, language):
    tree = _parser(language).parse(raw)
    root = tree.root_node
    if root.has_error and language != "sql":
        raise AnalyzerInputError("syntax_error")
    facts = []
    for node in _walk(root):
        symbol_kind = SYMBOLS.get(node.type)
        if symbol_kind:
            name = _name(node, raw)
            _append_fact(facts, _fact(symbol_kind, path, source_id, node, name))
        if node.type == "decorator":
            match = re.match(r"^@([A-Za-z_$][\w$]*)", _text(node, raw).strip())
            if match and not _sensitive_name(match.group(1)):
                _append_fact(facts, _fact("decorator", path, source_id, node, match.group(1)))
        if node.type == "export_statement":
            declaration = node.child_by_field_name("declaration")
            if declaration is not None:
                candidate = declaration if _name(declaration, raw) else next(
                    (child for child in _walk(declaration) if child.type in {"class_declaration", "function_declaration", "interface_declaration", "type_alias_declaration", "enum_declaration", "variable_declarator"} and _name(child, raw)),
                    None,
                )
                exported_name = _name(candidate, raw) if candidate is not None else None
                if exported_name:
                    _append_fact(facts, _fact("export", path, source_id, node, exported_name))
            else:
                for specifier in (child for child in _walk(node) if child.type == "export_specifier"):
                    exported_name = _name(specifier, raw)
                    if exported_name:
                        _append_fact(facts, _fact("export", path, source_id, specifier, exported_name))
        if node.type == "field_definition":
            owner = next((ancestor for ancestor in _ancestors(node) if ancestor.type == "object_type_definition"), None)
            owner_name = _name(owner, raw) if owner is not None else None
            operation = {"Query": "query", "Mutation": "mutation", "Subscription": "subscription"}.get(owner_name)
            if operation:
                _append_fact(facts, _fact("graphql_operation", path, source_id, node, _name(node, raw), operation_type=operation))
        if node.type in {"import_statement", "import_from_statement"}:
            module = (node.child_by_field_name("source") or node.child_by_field_name("module")
                      or node.child_by_field_name("module_name"))
            if module is not None:
                module_name = _text(module, raw).strip("\"'` ")
                if len(module_name) <= 200 and not _sensitive_name(module_name):
                    _append_fact(facts, _fact("import", path, source_id, node, module_name))
    imports = {fact.get("name") for fact in facts if fact["kind"] == "import"}
    nest_module = language not in {"typescript", "tsx", "javascript"} or any(
        fact["kind"] == "import" and fact.get("name") == "@nestjs/common" for fact in facts
    )
    nest_graphql_module = any(fact["kind"] == "import" and fact.get("name") == "@nestjs/graphql" for fact in facts)
    if language in {"typescript", "tsx", "javascript"}:
        rest_adapter = ("express_route_syntax" if "express" in imports else
                        "fastify_route_syntax" if "fastify" in imports else None)
        if rest_adapter:
            for call in (node for node in _walk(root) if node.type == "call_expression"):
                function = call.child_by_field_name("function")
                if function is None or function.type != "member_expression":
                    continue
                method_node = function.child_by_field_name("property")
                args = call.child_by_field_name("arguments")
                route = _literal_string(args.named_children[0], raw) if args and args.named_children else None
                method_name = _text(method_node, raw) if method_node else ""
                if route is not None and method_name.lower() in HTTP_METHODS:
                    _append_fact(facts, _fact("rest_route", path, source_id, call,
                                              method_name, http_method=method_name.upper(), route=route,
                                              adapter=rest_adapter))
        if nest_module:
            for class_node in (node for node in _walk(root) if node.type == "class_declaration"):
                decorators = _direct_decorators(class_node, raw) + _preceding_decorators(class_node, raw)
                if any(re.match(r"^@Module\s*(?:\(|$)", text.strip()) for text in decorators):
                    _append_fact(facts, _fact("nest_module", path, source_id, class_node,
                                              _name(class_node, raw), adapter="nestjs_decorator_syntax"))
        for method in (node for node in _walk(root) if node.type == "method_definition"):
            if not (nest_module or nest_graphql_module):
                continue
            method_name = _name(method, raw)
            if method_name is None:
                continue
            class_node = next((ancestor for ancestor in _ancestors(method) if ancestor.type == "class_declaration"), None)
            if class_node is None:
                continue
            class_decorators = _direct_decorators(class_node, raw) + _preceding_decorators(class_node, raw)
            # In TypeScript the decorator for an exported class is a sibling on export_statement.
            if class_node.parent is not None and class_node.parent.type == "export_statement":
                class_decorators.extend(_direct_decorators(class_node.parent, raw))
            controller_path = ""
            controller_supported = True
            for text in class_decorators:
                parsed = _literal_decorator(text)
                if parsed and parsed[0] == "Controller":
                    controller_path = parsed[1].strip("/")
                    break
                if re.match(r"^@Controller\s*\(", text.strip()):
                    controller_supported = False
            for text in _preceding_decorators(method, raw):
                parsed = _literal_decorator(text)
                if parsed and parsed[0] in HTTP_DECORATORS and nest_module and controller_supported:
                    route = parsed[1].strip("/")
                    full_path = "/" + "/".join(part for part in (controller_path, route) if part)
                    _append_fact(facts, _fact("rest_route", path, source_id, method,
                                              method_name, http_method=HTTP_DECORATORS[parsed[0]], route=full_path,
                                              adapter="nestjs_decorator_syntax"))
                graphql_decorator = re.match(r"^@(Query|Mutation|Subscription)(?:\s*\(|\s*$)", text.strip())
                if graphql_decorator and nest_graphql_module:
                    _append_fact(facts, _fact("graphql_resolver_operation", path, source_id, method,
                                              method_name, operation_type=GRAPHQL_DECORATORS[graphql_decorator.group(1)],
                                              adapter="nestjs_graphql_decorator_syntax"))
    if language == "python" and ("fastapi" in imports or "flask" in imports):
        adapter = "fastapi_decorator_syntax" if "fastapi" in imports else "flask_decorator_syntax"
        for decorated in (node for node in _walk(root) if node.type == "decorated_definition"):
            definition = decorated.child_by_field_name("definition")
            if definition is None:
                continue
            operation = _name(definition, raw)
            for decorator in (child for child in decorated.named_children if child.type == "decorator"):
                value = _text(decorator, raw)
                match = re.match(r"^@[A-Za-z_$][\w$]*\.(get|put|post|delete|options|head|patch|trace)\s*\(\s*(['\"])([^'\"\\\r\n]{0,500})\2", value, re.IGNORECASE)
                if match:
                    _append_fact(facts, _fact("rest_route", path, source_id, definition, operation,
                                              http_method=match.group(1).upper(), route=match.group(3), adapter=adapter))
                    continue
                if adapter == "flask_decorator_syntax":
                    match = re.match(r"^@[A-Za-z_$][\w$]*\.route\s*\(\s*(['\"])([^'\"\\\r\n]{0,500})\1", value)
                    if match:
                        methods = re.search(r"methods\s*=\s*\[([^\]]{0,200})\]", value)
                        verbs = re.findall(r"['\"](GET|PUT|POST|DELETE|OPTIONS|HEAD|PATCH|TRACE)['\"]", methods.group(1), re.IGNORECASE) if methods else ["GET"]
                        for verb in sorted({method.upper() for method in verbs}):
                            _append_fact(facts, _fact("rest_route", path, source_id, definition, operation,
                                                      http_method=verb, route=match.group(2), adapter=adapter))
    if language == "sql":
        for table in (node for node in _walk(root) if node.type == "CreateStmt"):
            relation = next((child for child in table.named_children if child.type == "qualified_name"), None)
            table_name = _text(relation, raw).strip() if relation is not None else None
            if table_name and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?', table_name):
                _append_fact(facts, _fact("database_table", path, source_id, table, table_name,
                                          adapter="postgres_ddl", parse_quality="complete"))
                for column in (node for node in _walk(table) if node.type == "columnDef"):
                    identifier = next((child for child in column.named_children if child.type == "ColId"), None)
                    type_node = next((child for child in column.named_children if child.type == "Typename"), None)
                    column_name = _text(identifier, raw).strip() if identifier is not None else None
                    if column_name and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_$]*', column_name):
                        _append_fact(facts, _fact("database_column", path, source_id, column, column_name,
                                                  table=table_name, data_type=_text(type_node, raw)[:80] if type_node else "unknown",
                                                  parse_quality="complete"))
    return facts, root.has_error


def _dependency_facts(path, source_id, raw, json_lines):
    dependencies = []
    if Path(path).name == "package.json":
        manifest = json.loads(raw)
        if not isinstance(manifest, dict):
            raise AnalyzerInputError("invalid_dependency_manifest")
        for group in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            entries = manifest.get(group, {})
            if not isinstance(entries, dict):
                raise AnalyzerInputError("invalid_dependency_manifest")
            for name, spec in entries.items():
                if isinstance(name, str) and isinstance(spec, str) and not _sensitive_name(name) and SAFE_DEP_SPEC.fullmatch(spec):
                    row = json_lines.get((group, name), 1)
                    dependencies.append((name, spec, group, row))
                    if len(dependencies) > MAX_FILE_FACTS:
                        raise AnalyzerInputError("fact_limit")
    elif Path(path).name == "pyproject.toml":
        manifest = tomllib.loads(raw.decode("utf-8"))
        project = manifest.get("project", {})
        source_lines = raw.decode("utf-8").splitlines()
        if isinstance(project, dict):
            for spec in project.get("dependencies", []) if isinstance(project.get("dependencies", []), list) else []:
                match = PY_REQUIREMENT.match(spec) if isinstance(spec, str) else None
                if match and not _sensitive_name(match.group(1)) and SAFE_DEP_SPEC.fullmatch(match.group(2) or ""):
                    needle = spec.strip().strip("'\"")
                    row = next((index for index, text in enumerate(source_lines, start=1) if needle in text), 1)
                    dependencies.append((match.group(1), match.group(2).strip(), "project", row))
                    if len(dependencies) > MAX_FILE_FACTS:
                        raise AnalyzerInputError("fact_limit")
    elif Path(path).name.lower().startswith("requirements") and Path(path).suffix == ".txt":
        for line, text in enumerate(raw.decode("utf-8").splitlines(), start=1):
            candidate = text.split("#", 1)[0].strip()
            match = PY_REQUIREMENT.match(candidate)
            if match and not candidate.startswith(("-", ".", "/")) and not _sensitive_name(match.group(1)):
                dependencies.append((match.group(1), match.group(2).strip(), "requirements", line))
                if len(dependencies) > MAX_FILE_FACTS:
                    raise AnalyzerInputError("fact_limit")
    for name, spec, group, row in dependencies:
        yield _line_fact("dependency", path, source_id, row, name,
                         ecosystem=group, version_spec=spec or "unknown")


def _openapi_facts(path, source_id, raw, json_lines):
    if Path(path).suffix.lower() == ".json":
        document = json.loads(raw)
        line_map = json_lines
    else:
        document, line_map = _load_yaml(raw)
    if not isinstance(document, dict) or not isinstance(document.get("openapi"), str):
        raise AnalyzerInputError("invalid_openapi_document")
    facts = []
    paths = document.get("paths", {})
    if not isinstance(paths, dict):
        raise AnalyzerInputError("invalid_openapi_document")
    for route, operations in paths.items():
        if not isinstance(route, str) or len(route) > 500 or not isinstance(operations, dict):
            continue
        for method, operation in operations.items():
            if method.lower() not in HTTP_METHODS or not isinstance(operation, dict):
                continue
            operation_id = operation.get("operationId")
            if isinstance(operation_id, str) and _sensitive_name(operation_id):
                operation_id = None
            route_line = line_map.get(("paths", route, method), line_map.get(("paths", route), 1))
            _append_fact(facts, _line_fact("openapi_operation", path, source_id, route_line, operation_id,
                                           http_method=method.upper(), route=route, evidence="openapi_document"))
    components = document.get("components", {})
    schemas = components.get("schemas", {}) if isinstance(components, dict) else {}
    if isinstance(schemas, dict):
        for name in schemas:
            if isinstance(name, str) and len(name) <= 200 and not _sensitive_name(name):
                line = line_map.get(("components", "schemas", name), 1)
                _append_fact(facts, _line_fact("openapi_schema", path, source_id, line, name, evidence="openapi_document"))
    return facts


def _load_yaml(raw):
    loader = StrictYamlLoader(raw.decode("utf-8"))
    locations = {}
    depth = 0

    def build(node, path):
        nonlocal depth
        depth += 1
        try:
            if depth > MAX_YAML_DEPTH:
                raise AnalyzerInputError("yaml_structure_limit")
            if isinstance(node, yaml.MappingNode):
                result = {}
                for key_node, value_node in node.value:
                    key = loader.construct_object(key_node, deep=True)
                    if not isinstance(key, str) or key in result:
                        raise AnalyzerInputError("yaml_duplicate_or_invalid_key")
                    next_path = path + (key,)
                    locations[next_path] = key_node.start_mark.line + 1
                    result[key] = build(value_node, next_path)
                return result
            if isinstance(node, yaml.SequenceNode):
                return [build(child, path + (str(index),)) for index, child in enumerate(node.value)]
            return loader.construct_object(node, deep=True)
        finally:
            depth -= 1

    try:
        root = loader.get_single_node()
        document = build(root, ()) if root is not None else None
        return document, locations
    finally:
        loader.dispose()


def _documentation_facts(path, source_id, raw):
    facts = []
    fenced = False
    for line_no, line in enumerate(raw.decode("utf-8").splitlines(), start=1):
        stripped = line.lstrip()
        if stripped.startswith(("```", "~~~")):
            fenced = not fenced
            continue
        if fenced:
            continue
        match = re.match(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if match and not _sensitive_name(match.group(2)):
            _append_fact(facts, _line_fact("documentation_section", path, source_id, line_no,
                                           match.group(2)[:200], heading_level=len(match.group(1)), evidence="markdown_heading"))
    if Path(path).suffix.lower() == ".rst":
        lines = raw.decode("utf-8").splitlines()
        for index in range(len(lines) - 1):
            title, underline = lines[index].strip(), lines[index + 1].strip()
            if (title and len(title) <= 200 and len(underline) >= len(title)
                    and len(set(underline)) == 1 and underline[0] in "=-~^\"'`:+*#<>_"
                    and not _sensitive_name(title)):
                _append_fact(facts, _line_fact("documentation_section", path, source_id, index + 1,
                                               title, heading_level=1, evidence="rst_heading"))
    return facts


def analyze_source(path, source_id, raw):
    """Analyze one already secret-screened file; outputs metadata, never file text."""
    suffix = Path(path).suffix.lower()
    name = Path(path).name.lower()
    started = time.monotonic()
    facts = []
    status = "unsupported"
    reason = None
    try:
        if name in {"package.json", "pyproject.toml"} or (name.startswith("requirements") and suffix == ".txt"):
            status = "analyzed"
            json_lines = _json_lines(raw) if name == "package.json" else {}
            facts.extend(_dependency_facts(path, source_id, raw, json_lines))
        elif suffix in {".ts", ".tsx", ".js", ".jsx", ".py", ".graphql", ".gql", ".sql"}:
            language = {".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "javascript",
                        ".py": "python", ".graphql": "graphql", ".gql": "graphql", ".sql": "sql"}[suffix]
            syntax_facts, parse_partial = _extract_syntax(path, source_id, raw, language)
            facts.extend(syntax_facts)
            status = "partial" if parse_partial else "analyzed"
            reason = "partial_syntax_recovery" if parse_partial else None
        elif "openapi" in name or "swagger" in name:
            json_lines = _json_lines(raw) if suffix == ".json" else {}
            facts.extend(_openapi_facts(path, source_id, raw, json_lines))
            status = "analyzed"
        elif suffix in {".md", ".rst"}:
            facts.extend(_documentation_facts(path, source_id, raw))
            status = "analyzed"
    except (AnalyzerInputError, UnicodeDecodeError, json.JSONDecodeError, tomllib.TOMLDecodeError, yaml.YAMLError, RecursionError, ValueError, TypeError, KeyError):
        status = "failed"
        reason = "invalid_or_unsupported_syntax"
        facts.clear()
    return {"status": status, "reason": reason, "duration_ms": round((time.monotonic() - started) * 1000, 3), "facts": facts}


def analyze_project_rows(rows):
    """Produce explicit coverage counters for the analyzer artifact."""
    counts = {}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    facts = [fact for row in rows for fact in row["facts"]]
    facts_by_kind = {}
    for fact in facts:
        facts_by_kind[fact["kind"]] = facts_by_kind.get(fact["kind"], 0) + 1
    return {"schema_version": 1, "analyzer_version": VERSION,
            "status": "partial" if counts.get("failed", 0) or counts.get("partial", 0) or counts.get("unsupported", 0) else "complete",
            "files_analyzed": counts.get("analyzed", 0), "files_unsupported": counts.get("unsupported", 0),
            "files_partial": counts.get("partial", 0), "files_failed": counts.get("failed", 0),
            "parse_duration_ms": round(sum(row["duration_ms"] for row in rows), 3),
            "facts_count": len(facts), "facts_by_kind": dict(sorted(facts_by_kind.items())),
            "failures": sorted(({"path": row["path"], "reason": row["reason"]} for row in rows if row["status"] in {"failed", "partial"}), key=lambda row: row["path"]),
            "facts": sorted(facts, key=lambda fact: (fact["path"], fact["line_start"], fact["kind"], fact.get("name", "")))}
