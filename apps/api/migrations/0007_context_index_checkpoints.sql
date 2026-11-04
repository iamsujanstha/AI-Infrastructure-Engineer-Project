-- Promote the first atomic graph writer into a restricted, resumable publisher.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_runtime') THEN
    EXECUTE 'CREATE ROLE context_runtime NOLOGIN NOBYPASSRLS';
  END IF;
END $$;
ALTER ROLE context_runtime NOLOGIN NOBYPASSRLS;
GRANT context_runtime TO CURRENT_USER;

ALTER TABLE context_platform.graph_generations
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'published' CHECK (state IN ('building', 'published'));
ALTER TABLE context_platform.graph_generations ALTER COLUMN published_at DROP NOT NULL;
ALTER TABLE context_platform.graph_heads
  DROP CONSTRAINT IF EXISTS graph_heads_tenant_id_project_id_environment_id_generation_fkey;
ALTER TABLE context_platform.graph_heads
  DROP CONSTRAINT IF EXISTS graph_heads_tenant_id_project_id_environment_id_generation_id_fkey;
ALTER TABLE context_platform.graph_heads
  ADD CONSTRAINT graph_heads_generation_scope_fk
  FOREIGN KEY (tenant_id, project_id, environment_id, generation_id)
  REFERENCES context_platform.graph_generations (tenant_id, project_id, environment_id, generation_id)
  ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS context_platform.index_checkpoints (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  checkpoint_key text NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  row_count integer NOT NULL CHECK (row_count >= 0),
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id, environment_id, generation_id, checkpoint_key),
  FOREIGN KEY (tenant_id, project_id, environment_id, generation_id)
    REFERENCES context_platform.graph_generations (tenant_id, project_id, environment_id, generation_id) ON DELETE CASCADE
);

-- Environment-owned rows additionally require a matching transaction-local environment scope.
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['graph_generations','graph_heads','graph_sources','graph_nodes','graph_edges'] LOOP
    EXECUTE format('DROP POLICY scope_guard ON context_platform.%I', table_name);
    EXECUTE format('CREATE POLICY scope_guard ON context_platform.%I USING (tenant_id = nullif(current_setting(''context.tenant_id'', true), '''')::uuid AND project_id = nullif(current_setting(''context.project_id'', true), '''')::uuid AND environment_id = nullif(current_setting(''context.environment_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''context.tenant_id'', true), '''')::uuid AND project_id = nullif(current_setting(''context.project_id'', true), '''')::uuid AND environment_id = nullif(current_setting(''context.environment_id'', true), '''')::uuid)', table_name);
  END LOOP;
END $$;
ALTER TABLE context_platform.index_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_platform.index_checkpoints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scope_guard ON context_platform.index_checkpoints;
CREATE POLICY scope_guard ON context_platform.index_checkpoints
  USING (tenant_id = nullif(current_setting('context.tenant_id', true), '')::uuid
    AND project_id = nullif(current_setting('context.project_id', true), '')::uuid
    AND environment_id = nullif(current_setting('context.environment_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('context.tenant_id', true), '')::uuid
    AND project_id = nullif(current_setting('context.project_id', true), '')::uuid
    AND environment_id = nullif(current_setting('context.environment_id', true), '')::uuid);

GRANT USAGE ON SCHEMA context_platform TO context_runtime;
GRANT SELECT, INSERT ON context_platform.projects, context_platform.environments,
  context_platform.graph_sources, context_platform.graph_nodes, context_platform.graph_edges,
  context_platform.index_checkpoints TO context_runtime;
GRANT DELETE ON context_platform.environments TO context_runtime;
GRANT SELECT, INSERT ON context_platform.graph_generations, context_platform.graph_heads TO context_runtime;
GRANT UPDATE (state, published_at) ON context_platform.graph_generations TO context_runtime;
GRANT UPDATE (generation_id, updated_at) ON context_platform.graph_heads TO context_runtime;
