-- Core durable model. Keep inference state, conversation history, memory, and retrieved context distinct.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = btrim(email)),
  display_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deletion_pending')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX users_active_email_uq ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT projects_id_owner_uq UNIQUE (id, owner_user_id)
);

CREATE UNIQUE INDEX projects_active_owner_slug_uq
  ON projects (owner_user_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX projects_owner_updated_idx
  ON projects (owner_user_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE TABLE model_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text NOT NULL UNIQUE CHECK (profile_key ~ '^[a-z0-9][a-z0-9._-]*$'),
  provider_key text NOT NULL CHECK (length(btrim(provider_key)) > 0),
  model_identifier text NOT NULL CHECK (length(btrim(model_identifier)) > 0),
  model_type text NOT NULL CHECK (model_type IN ('chat', 'embedding', 'reranker', 'multimodal')),
  context_window_tokens integer CHECK (context_window_tokens > 0),
  max_output_tokens integer CHECK (max_output_tokens > 0),
  embedding_dimensions integer CHECK (embedding_dimensions BETWEEN 1 AND 16000),
  tokenizer_identifier text,
  capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CHECK (max_output_tokens IS NULL OR context_window_tokens IS NULL OR max_output_tokens <= context_window_tokens),
  CHECK (model_type <> 'embedding' OR embedding_dimensions IS NOT NULL)
);

CREATE INDEX model_profiles_provider_enabled_idx
  ON model_profiles (provider_key, model_type, profile_key) WHERE is_enabled AND deleted_at IS NULL;

CREATE TABLE model_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_profile_id uuid NOT NULL REFERENCES model_profiles(id) ON DELETE RESTRICT,
  instance_key text NOT NULL CHECK (instance_key ~ '^[a-z0-9][a-z0-9._-]*$'),
  endpoint_url text,
  credential_secret_ref text,
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'healthy', 'unhealthy', 'disabled')),
  last_health_check_at timestamptz,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT model_instances_id_profile_uq UNIQUE (id, model_profile_id),
  CONSTRAINT model_instances_profile_key_uq UNIQUE (model_profile_id, instance_key)
);

CREATE INDEX model_instances_profile_status_idx
  ON model_instances (model_profile_id, status) WHERE deleted_at IS NULL;

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id uuid,
  title text NOT NULL DEFAULT 'New conversation',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  next_message_sequence bigint NOT NULL DEFAULT 1 CHECK (next_message_sequence > 0),
  last_message_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  parent_conversation_id uuid,
  forked_from_message_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT conversations_id_owner_uq UNIQUE (id, owner_user_id),
  CONSTRAINT conversations_project_owner_fk
    FOREIGN KEY (project_id, owner_user_id) REFERENCES projects(id, owner_user_id) ON DELETE RESTRICT,
  CONSTRAINT conversations_parent_owner_fk
    FOREIGN KEY (parent_conversation_id, owner_user_id) REFERENCES conversations(id, owner_user_id) ON DELETE RESTRICT,
  CHECK ((parent_conversation_id IS NULL) = (forked_from_message_id IS NULL))
);

CREATE INDEX conversations_owner_recent_idx
  ON conversations (owner_user_id, last_message_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX conversations_project_recent_idx
  ON conversations (project_id, last_message_at DESC, id DESC) WHERE project_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX conversations_parent_idx ON conversations (parent_conversation_id) WHERE parent_conversation_id IS NOT NULL;

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  status text NOT NULL DEFAULT 'complete' CHECK (status IN ('streaming', 'complete', 'failed', 'cancelled')),
  provider_message_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalized_at timestamptz DEFAULT clock_timestamp(),
  CONSTRAINT messages_conversation_sequence_uq UNIQUE (conversation_id, sequence),
  CONSTRAINT messages_conversation_owner_sequence_uq UNIQUE (conversation_id, owner_user_id, sequence),
  CONSTRAINT messages_id_conversation_uq UNIQUE (id, conversation_id),
  CONSTRAINT messages_id_owner_uq UNIQUE (id, owner_user_id),
  CONSTRAINT messages_id_conversation_owner_uq UNIQUE (id, conversation_id, owner_user_id),
  CONSTRAINT messages_conversation_owner_fk
    FOREIGN KEY (conversation_id, owner_user_id) REFERENCES conversations(id, owner_user_id) ON DELETE CASCADE,
  CHECK ((status = 'streaming' AND finalized_at IS NULL) OR (status <> 'streaming' AND finalized_at IS NOT NULL))
);

ALTER TABLE conversations
  ADD CONSTRAINT conversations_fork_message_fk
  FOREIGN KEY (forked_from_message_id, parent_conversation_id, owner_user_id)
  REFERENCES messages(id, conversation_id, owner_user_id) ON DELETE RESTRICT;

CREATE INDEX messages_conversation_recent_idx
  ON messages (conversation_id, sequence DESC);
CREATE INDEX messages_owner_created_idx
  ON messages (owner_user_id, created_at DESC, id DESC);
CREATE INDEX messages_provider_id_idx
  ON messages (provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE message_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  part_index integer NOT NULL CHECK (part_index >= 0),
  part_type text NOT NULL CHECK (part_type IN ('text', 'reasoning', 'tool_call', 'tool_result', 'image', 'metadata')),
  text_content text,
  data jsonb,
  storage_key text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT message_parts_message_index_uq UNIQUE (message_id, part_index),
  FOREIGN KEY (message_id, conversation_id, owner_user_id)
    REFERENCES messages(id, conversation_id, owner_user_id) ON DELETE CASCADE,
  CHECK (
    (part_type IN ('text', 'reasoning') AND text_content IS NOT NULL)
    OR (part_type IN ('tool_call', 'tool_result', 'metadata') AND data IS NOT NULL)
    OR (part_type = 'image' AND (storage_key IS NOT NULL OR data IS NOT NULL))
  )
);

CREATE TABLE memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id uuid,
  memory_type text NOT NULL CHECK (memory_type IN ('user', 'project', 'technical', 'decision', 'fact', 'preference', 'procedure', 'incident')),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  content text NOT NULL CHECK (length(btrim(content)) > 0),
  importance real NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
  confidence real NOT NULL DEFAULT 0.8 CHECK (confidence BETWEEN 0 AND 1),
  source_type text NOT NULL CHECK (source_type IN ('user_input', 'agent_extraction', 'document', 'import', 'operator')),
  source_message_id uuid,
  source_document_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'archived')),
  usage_count bigint NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  last_used_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT memories_id_owner_uq UNIQUE (id, owner_user_id),
  FOREIGN KEY (project_id, owner_user_id) REFERENCES projects(id, owner_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_message_id, owner_user_id) REFERENCES messages(id, owner_user_id) ON DELETE SET NULL (source_message_id),
  CHECK ((memory_type = 'user' AND project_id IS NULL) OR memory_type <> 'user'),
  CHECK ((memory_type = 'project' AND project_id IS NOT NULL) OR memory_type <> 'project'),
  CHECK ((source_type = 'document' AND source_document_id IS NOT NULL) OR (source_type <> 'document' AND source_document_id IS NULL))
);

CREATE INDEX memories_owner_scope_recent_idx
  ON memories (owner_user_id, project_id, updated_at DESC, id DESC)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX memories_owner_importance_idx
  ON memories (owner_user_id, project_id, importance DESC, updated_at DESC)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX memories_source_message_idx ON memories (source_message_id) WHERE source_message_id IS NOT NULL;
CREATE INDEX memories_content_fts_idx ON memories USING gin (to_tsvector('simple', content)) WHERE status = 'active' AND deleted_at IS NULL;

CREATE TABLE memory_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_memory_id uuid NOT NULL,
  target_memory_id uuid NOT NULL,
  relation_type text NOT NULL CHECK (relation_type IN ('supports', 'contradicts', 'supersedes', 'related_to', 'derived_from')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (source_memory_id, owner_user_id) REFERENCES memories(id, owner_user_id) ON DELETE CASCADE,
  FOREIGN KEY (target_memory_id, owner_user_id) REFERENCES memories(id, owner_user_id) ON DELETE CASCADE,
  CHECK (source_memory_id <> target_memory_id),
  CONSTRAINT memory_links_relation_uq UNIQUE (source_memory_id, target_memory_id, relation_type)
);

CREATE INDEX memory_links_target_idx ON memory_links (target_memory_id, relation_type);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_id uuid,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  original_filename text,
  media_type text NOT NULL,
  storage_key text NOT NULL CHECK (length(btrim(storage_key)) > 0),
  content_sha256 char(64) CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'archived')),
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT documents_id_owner_uq UNIQUE (id, owner_user_id),
  FOREIGN KEY (project_id, owner_user_id) REFERENCES projects(id, owner_user_id) ON DELETE RESTRICT
);

CREATE INDEX documents_owner_scope_recent_idx
  ON documents (owner_user_id, project_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX documents_status_created_idx ON documents (status, created_at) WHERE status IN ('pending', 'processing');
CREATE UNIQUE INDEX documents_active_content_hash_uq
  ON documents (owner_user_id, project_id, content_sha256)
  WHERE content_sha256 IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE memories
  ADD CONSTRAINT memories_source_document_owner_fk
  FOREIGN KEY (source_document_id, owner_user_id) REFERENCES documents(id, owner_user_id) ON DELETE RESTRICT;
CREATE INDEX memories_source_document_idx ON memories (source_document_id) WHERE source_document_id IS NOT NULL;

CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content text NOT NULL CHECK (length(btrim(content)) > 0),
  token_count_estimated integer CHECK (token_count_estimated >= 0),
  start_offset integer CHECK (start_offset >= 0),
  end_offset integer CHECK (end_offset >= start_offset),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT document_chunks_document_index_uq UNIQUE (document_id, chunk_index),
  CONSTRAINT document_chunks_id_owner_uq UNIQUE (id, owner_user_id),
  FOREIGN KEY (document_id, owner_user_id) REFERENCES documents(id, owner_user_id) ON DELETE CASCADE
);

CREATE INDEX document_chunks_owner_document_idx ON document_chunks (owner_user_id, document_id, chunk_index);
CREATE INDEX document_chunks_content_fts_idx ON document_chunks USING gin (to_tsvector('simple', content));

CREATE TABLE embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  memory_id uuid,
  document_chunk_id uuid,
  embedding_model text NOT NULL CHECK (length(btrim(embedding_model)) > 0),
  dimensions integer NOT NULL CHECK (dimensions BETWEEN 1 AND 16000),
  embedding vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (memory_id, owner_user_id) REFERENCES memories(id, owner_user_id) ON DELETE CASCADE,
  FOREIGN KEY (document_chunk_id, owner_user_id) REFERENCES document_chunks(id, owner_user_id) ON DELETE CASCADE,
  CHECK ((memory_id IS NULL) <> (document_chunk_id IS NULL)),
  CHECK (vector_dims(embedding) = dimensions)
);

CREATE UNIQUE INDEX embeddings_memory_model_uq
  ON embeddings (memory_id, embedding_model) WHERE memory_id IS NOT NULL;
CREATE UNIQUE INDEX embeddings_chunk_model_uq
  ON embeddings (document_chunk_id, embedding_model) WHERE document_chunk_id IS NOT NULL;
CREATE INDEX embeddings_owner_model_dimensions_idx
  ON embeddings (owner_user_id, embedding_model, dimensions);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  input_message_id uuid NOT NULL,
  assistant_message_id uuid,
  model_profile_id uuid NOT NULL REFERENCES model_profiles(id) ON DELETE RESTRICT,
  model_instance_id uuid,
  retry_of_run_id uuid,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out')),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT agent_runs_id_conversation_owner_uq UNIQUE (id, conversation_id, owner_user_id),
  FOREIGN KEY (conversation_id, owner_user_id) REFERENCES conversations(id, owner_user_id) ON DELETE CASCADE,
  FOREIGN KEY (input_message_id, conversation_id, owner_user_id)
    REFERENCES messages(id, conversation_id, owner_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (assistant_message_id, conversation_id, owner_user_id)
    REFERENCES messages(id, conversation_id, owner_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (model_instance_id, model_profile_id)
    REFERENCES model_instances(id, model_profile_id) ON DELETE RESTRICT,
  FOREIGN KEY (retry_of_run_id, conversation_id, owner_user_id)
    REFERENCES agent_runs(id, conversation_id, owner_user_id) ON DELETE RESTRICT,
  CHECK ((status IN ('queued', 'running') AND finished_at IS NULL) OR (status NOT IN ('queued', 'running') AND finished_at IS NOT NULL))
);

CREATE INDEX agent_runs_conversation_recent_idx ON agent_runs (conversation_id, created_at DESC, id DESC);
CREATE INDEX agent_runs_owner_recent_idx ON agent_runs (owner_user_id, created_at DESC, id DESC);
CREATE INDEX agent_runs_model_profile_recent_idx ON agent_runs (model_profile_id, created_at DESC, id DESC);
CREATE INDEX agent_runs_model_instance_idx ON agent_runs (model_instance_id) WHERE model_instance_id IS NOT NULL;
CREATE INDEX agent_runs_retry_of_idx ON agent_runs (retry_of_run_id) WHERE retry_of_run_id IS NOT NULL;
CREATE INDEX agent_runs_input_message_idx ON agent_runs (input_message_id);
CREATE INDEX agent_runs_assistant_message_idx ON agent_runs (assistant_message_id) WHERE assistant_message_id IS NOT NULL;
CREATE INDEX agent_runs_status_created_idx ON agent_runs (status, created_at) WHERE status IN ('queued', 'running');

CREATE TABLE tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  call_sequence integer NOT NULL CHECK (call_sequence >= 0),
  provider_call_id text,
  tool_name text NOT NULL CHECK (length(btrim(tool_name)) > 0),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'running', 'succeeded', 'failed', 'denied', 'cancelled')),
  arguments jsonb NOT NULL CHECK (jsonb_typeof(arguments) = 'object'),
  result jsonb,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT tool_calls_run_sequence_uq UNIQUE (agent_run_id, call_sequence),
  CHECK ((status IN ('requested', 'running') AND finished_at IS NULL) OR (status NOT IN ('requested', 'running') AND finished_at IS NOT NULL))
);

CREATE UNIQUE INDEX tool_calls_provider_id_uq
  ON tool_calls (agent_run_id, provider_call_id) WHERE provider_call_id IS NOT NULL;
CREATE INDEX tool_calls_run_created_idx ON tool_calls (agent_run_id, created_at, call_sequence);

CREATE TABLE inference_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id varchar(64) NOT NULL UNIQUE CHECK (request_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  owner_user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  agent_run_id uuid,
  model_profile_id uuid NOT NULL REFERENCES model_profiles(id) ON DELETE RESTRICT,
  model_instance_id uuid,
  provider_key text NOT NULL,
  model_identifier text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'preparing', 'streaming', 'succeeded', 'failed', 'cancelled', 'timed_out')),
  context_window_tokens integer CHECK (context_window_tokens > 0),
  reserved_output_tokens integer CHECK (reserved_output_tokens >= 0),
  input_tokens_estimated bigint CHECK (input_tokens_estimated >= 0),
  input_tokens_reported bigint CHECK (input_tokens_reported >= 0),
  output_tokens_estimated bigint CHECK (output_tokens_estimated >= 0),
  output_tokens_reported bigint CHECK (output_tokens_reported >= 0),
  cached_input_tokens_reported bigint CHECK (cached_input_tokens_reported >= 0),
  queue_wait_ms integer CHECK (queue_wait_ms >= 0),
  time_to_first_token_ms integer CHECK (time_to_first_token_ms >= 0),
  prompt_processing_ms integer CHECK (prompt_processing_ms >= 0),
  generation_ms integer CHECK (generation_ms >= 0),
  total_latency_ms integer CHECK (total_latency_ms >= 0),
  cache_hit boolean NOT NULL DEFAULT false,
  client_disconnected boolean NOT NULL DEFAULT false,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inference_requests_id_owner_uq UNIQUE (id, owner_user_id),
  FOREIGN KEY (conversation_id, owner_user_id) REFERENCES conversations(id, owner_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (agent_run_id, conversation_id, owner_user_id)
    REFERENCES agent_runs(id, conversation_id, owner_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (model_instance_id, model_profile_id)
    REFERENCES model_instances(id, model_profile_id) ON DELETE RESTRICT,
  CHECK (context_window_tokens IS NULL OR reserved_output_tokens IS NULL OR reserved_output_tokens <= context_window_tokens),
  CHECK ((status IN ('queued', 'preparing', 'streaming') AND finished_at IS NULL) OR (status NOT IN ('queued', 'preparing', 'streaming') AND finished_at IS NOT NULL))
);

CREATE INDEX inference_requests_owner_recent_idx
  ON inference_requests (owner_user_id, created_at DESC, id DESC);
CREATE INDEX inference_requests_conversation_recent_idx
  ON inference_requests (conversation_id, created_at DESC, id DESC);
CREATE INDEX inference_requests_agent_run_idx ON inference_requests (agent_run_id) WHERE agent_run_id IS NOT NULL;
CREATE INDEX inference_requests_model_recent_idx
  ON inference_requests (model_profile_id, created_at DESC, status);
CREATE INDEX inference_requests_slow_idx
  ON inference_requests (total_latency_ms DESC, created_at DESC) WHERE total_latency_ms IS NOT NULL;
CREATE INDEX inference_requests_open_idx
  ON inference_requests (status, created_at) WHERE status IN ('queued', 'preparing', 'streaming');

CREATE TABLE usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  inference_request_id uuid NOT NULL,
  metric_kind text NOT NULL CHECK (metric_kind IN ('input_tokens', 'output_tokens', 'cached_input_tokens', 'estimated_cost_microusd', 'reported_cost_microusd')),
  value numeric(20, 6) NOT NULL CHECK (value >= 0),
  measurement_source text NOT NULL CHECK (measurement_source IN ('estimator', 'provider', 'operator')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (inference_request_id, owner_user_id)
    REFERENCES inference_requests(id, owner_user_id) ON DELETE RESTRICT,
  CHECK (metric_kind NOT LIKE '%_tokens' OR value = trunc(value)),
  CONSTRAINT usage_request_metric_source_uq UNIQUE (inference_request_id, metric_kind, measurement_source)
);

CREATE INDEX usage_records_owner_time_idx ON usage_records (owner_user_id, recorded_at DESC, id DESC);

CREATE TABLE context_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  agent_run_id uuid NOT NULL,
  snapshot_sequence smallint NOT NULL DEFAULT 1 CHECK (snapshot_sequence > 0),
  policy_version text NOT NULL,
  context_window_tokens integer NOT NULL CHECK (context_window_tokens > 0),
  reserved_output_tokens integer NOT NULL CHECK (reserved_output_tokens >= 0),
  system_tokens_estimated integer NOT NULL CHECK (system_tokens_estimated >= 0),
  tool_tokens_estimated integer NOT NULL CHECK (tool_tokens_estimated >= 0),
  current_request_tokens_estimated integer NOT NULL CHECK (current_request_tokens_estimated >= 0),
  pinned_memory_tokens_estimated integer NOT NULL CHECK (pinned_memory_tokens_estimated >= 0),
  retrieved_memory_tokens_estimated integer NOT NULL CHECK (retrieved_memory_tokens_estimated >= 0),
  recent_history_tokens_estimated integer NOT NULL CHECK (recent_history_tokens_estimated >= 0),
  summary_tokens_estimated integer NOT NULL CHECK (summary_tokens_estimated >= 0),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'array'),
  total_input_tokens_estimated integer NOT NULL CHECK (total_input_tokens_estimated >= 0),
  model_profile_id uuid NOT NULL REFERENCES model_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (agent_run_id, conversation_id, owner_user_id)
    REFERENCES agent_runs(id, conversation_id, owner_user_id) ON DELETE CASCADE,
  CHECK (total_input_tokens_estimated = system_tokens_estimated + tool_tokens_estimated + current_request_tokens_estimated + pinned_memory_tokens_estimated + retrieved_memory_tokens_estimated + recent_history_tokens_estimated + summary_tokens_estimated),
  CHECK (reserved_output_tokens + total_input_tokens_estimated <= context_window_tokens),
  CONSTRAINT context_snapshots_run_sequence_uq UNIQUE (agent_run_id, snapshot_sequence)
);

CREATE INDEX context_snapshots_conversation_recent_idx
  ON context_snapshots (conversation_id, created_at DESC, id DESC);

CREATE TABLE summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  summary_type text NOT NULL CHECK (summary_type IN ('rolling', 'branch', 'problem', 'incident')),
  through_message_sequence bigint NOT NULL CHECK (through_message_sequence > 0),
  summary_text text NOT NULL CHECK (length(btrim(summary_text)) > 0),
  token_count_estimated integer CHECK (token_count_estimated >= 0),
  model_profile_id uuid REFERENCES model_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (conversation_id, owner_user_id) REFERENCES conversations(id, owner_user_id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id, owner_user_id, through_message_sequence)
    REFERENCES messages(conversation_id, owner_user_id, sequence) ON DELETE RESTRICT,
  CONSTRAINT summaries_conversation_type_sequence_uq UNIQUE (conversation_id, summary_type, through_message_sequence)
);

CREATE INDEX summaries_conversation_current_idx
  ON summaries (conversation_id, summary_type, through_message_sequence DESC);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name text NOT NULL,
  external_job_id text,
  job_type text NOT NULL,
  idempotency_key text,
  owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'active', 'completed', 'failed', 'cancelled', 'delayed')),
  attempts_made smallint NOT NULL DEFAULT 0 CHECK (attempts_made >= 0),
  attempts_limit smallint NOT NULL DEFAULT 3 CHECK (attempts_limit > 0),
  payload_reference jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload_reference) = 'object'),
  error_code text,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (attempts_made <= attempts_limit)
);

CREATE UNIQUE INDEX jobs_external_id_uq
  ON jobs (queue_name, external_job_id) WHERE external_job_id IS NOT NULL;
CREATE UNIQUE INDEX jobs_idempotency_key_uq
  ON jobs (queue_name, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX jobs_queue_ready_idx ON jobs (queue_name, available_at, created_at) WHERE status IN ('queued', 'delayed');
CREATE INDEX jobs_active_idx ON jobs (started_at) WHERE status = 'active';
CREATE INDEX jobs_owner_recent_idx ON jobs (owner_user_id, created_at DESC, id DESC) WHERE owner_user_id IS NOT NULL;

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  resource_type text NOT NULL CHECK (length(btrim(resource_type)) > 0),
  resource_id uuid,
  request_id varchar(64) CHECK (request_id IS NULL OR request_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  source_ip inet,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX audit_logs_actor_time_idx ON audit_logs (actor_user_id, created_at DESC, id DESC);
CREATE INDEX audit_logs_resource_time_idx ON audit_logs (resource_type, resource_id, created_at DESC, id DESC);
CREATE INDEX audit_logs_request_id_idx ON audit_logs (request_id) WHERE request_id IS NOT NULL;

CREATE FUNCTION set_updated_at_timestamp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users', 'projects', 'model_profiles', 'model_instances', 'conversations', 'memories', 'documents', 'jobs']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp()',
      table_name || '_set_updated_at',
      table_name
    );
  END LOOP;
END;
$$;
