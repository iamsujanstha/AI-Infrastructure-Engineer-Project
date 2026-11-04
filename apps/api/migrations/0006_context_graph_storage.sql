CREATE SCHEMA IF NOT EXISTS context_platform;

CREATE TABLE context_platform.projects (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id)
);

CREATE TABLE context_platform.environments (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  PRIMARY KEY (tenant_id, project_id, environment_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES context_platform.projects (tenant_id, project_id) ON DELETE CASCADE
);

CREATE TABLE context_platform.graph_generations (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  graph_version text NOT NULL,
  manifest_hash char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('complete', 'partial')),
  node_count integer NOT NULL CHECK (node_count >= 0),
  edge_count integer NOT NULL CHECK (edge_count >= 0),
  coverage jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id, environment_id, generation_id),
  UNIQUE (tenant_id, project_id, environment_id, manifest_hash),
  FOREIGN KEY (tenant_id, project_id, environment_id)
    REFERENCES context_platform.environments (tenant_id, project_id, environment_id) ON DELETE CASCADE
);

CREATE TABLE context_platform.graph_heads (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id, environment_id),
  FOREIGN KEY (tenant_id, project_id, environment_id, generation_id)
    REFERENCES context_platform.graph_generations (tenant_id, project_id, environment_id, generation_id)
);

CREATE TABLE context_platform.graph_sources (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  source_id uuid NOT NULL,
  relative_path text NOT NULL CHECK (relative_path !~ '(^/|(^|/)\.\.?(/|$))'),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  analysis_status text NOT NULL CHECK (analysis_status IN ('analyzed', 'partial', 'failed', 'unsupported')),
  PRIMARY KEY (tenant_id, project_id, environment_id, generation_id, source_id),
  FOREIGN KEY (tenant_id, project_id, environment_id, generation_id)
    REFERENCES context_platform.graph_generations (tenant_id, project_id, environment_id, generation_id) ON DELETE CASCADE
);

CREATE TABLE context_platform.graph_nodes (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  node_id uuid NOT NULL,
  node_type text NOT NULL,
  name text NOT NULL,
  attributes jsonb NOT NULL,
  provenance jsonb NOT NULL,
  PRIMARY KEY (tenant_id, project_id, environment_id, generation_id, node_id),
  FOREIGN KEY (tenant_id, project_id, environment_id, generation_id)
    REFERENCES context_platform.graph_generations (tenant_id, project_id, environment_id, generation_id) ON DELETE CASCADE
);

CREATE TABLE context_platform.graph_edges (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  edge_id uuid NOT NULL,
  source_node_id uuid NOT NULL,
  target_node_id uuid NOT NULL,
  relation text NOT NULL,
  provenance jsonb NOT NULL,
  PRIMARY KEY (tenant_id, project_id, environment_id, generation_id, edge_id),
  FOREIGN KEY (tenant_id, project_id, environment_id, generation_id)
    REFERENCES context_platform.graph_generations (tenant_id, project_id, environment_id, generation_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, project_id, environment_id, generation_id, source_node_id)
    REFERENCES context_platform.graph_nodes (tenant_id, project_id, environment_id, generation_id, node_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, project_id, environment_id, generation_id, target_node_id)
    REFERENCES context_platform.graph_nodes (tenant_id, project_id, environment_id, generation_id, node_id) ON DELETE CASCADE
);

CREATE INDEX graph_nodes_lookup ON context_platform.graph_nodes (tenant_id, project_id, environment_id, generation_id, node_type, name);
CREATE INDEX graph_edges_from ON context_platform.graph_edges (tenant_id, project_id, environment_id, generation_id, source_node_id);
CREATE INDEX graph_edges_to ON context_platform.graph_edges (tenant_id, project_id, environment_id, generation_id, target_node_id);

-- GUC-based policies are defense in depth; runtime roles must not own these tables or have BYPASSRLS.
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['projects','environments','graph_generations','graph_heads','graph_sources','graph_nodes','graph_edges'] LOOP
    EXECUTE format('ALTER TABLE context_platform.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE context_platform.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY scope_guard ON context_platform.%I USING (tenant_id = nullif(current_setting(''context.tenant_id'', true), '''')::uuid AND project_id = nullif(current_setting(''context.project_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''context.tenant_id'', true), '''')::uuid AND project_id = nullif(current_setting(''context.project_id'', true), '''')::uuid)', table_name);
  END LOOP;
END $$;
