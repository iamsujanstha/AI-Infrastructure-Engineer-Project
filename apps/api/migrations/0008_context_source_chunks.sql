CREATE TABLE context_platform.context_chunks (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  source_id uuid NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  relative_path text NOT NULL CHECK (relative_path !~ '(^/|(^|/)\.\.?(/|$))'),
  content text NOT NULL CHECK (length(btrim(content)) > 0 AND length(content) <= 4000 AND octet_length(content) <= 16000),
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  line_start integer NOT NULL CHECK (line_start >= 1),
  line_end integer NOT NULL CHECK (line_end >= line_start),
  chunker_version text NOT NULL CHECK (length(btrim(chunker_version)) BETWEEN 1 AND 40),
  PRIMARY KEY (tenant_id, project_id, environment_id, generation_id, chunk_id),
  UNIQUE (tenant_id, project_id, environment_id, generation_id, source_id, chunk_index),
  FOREIGN KEY (tenant_id, project_id, environment_id, generation_id)
    REFERENCES context_platform.graph_generations (tenant_id, project_id, environment_id, generation_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, project_id, environment_id, generation_id, source_id)
    REFERENCES context_platform.graph_sources (tenant_id, project_id, environment_id, generation_id, source_id) ON DELETE CASCADE
);

CREATE INDEX context_chunks_source_range_idx
  ON context_platform.context_chunks (tenant_id, project_id, environment_id, generation_id, source_id, line_start, chunk_index);
CREATE INDEX context_chunks_content_fts_idx
  ON context_platform.context_chunks USING gin (to_tsvector('simple', content));

ALTER TABLE context_platform.context_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_platform.context_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY scope_guard ON context_platform.context_chunks
  USING (tenant_id = nullif(current_setting('context.tenant_id', true), '')::uuid
    AND project_id = nullif(current_setting('context.project_id', true), '')::uuid
    AND environment_id = nullif(current_setting('context.environment_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('context.tenant_id', true), '')::uuid
    AND project_id = nullif(current_setting('context.project_id', true), '')::uuid
    AND environment_id = nullif(current_setting('context.environment_id', true), '')::uuid);

GRANT SELECT, INSERT ON context_platform.context_chunks TO context_runtime;
