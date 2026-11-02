-- Reuse a model instance key after retirement, but keep active keys unique per profile.
ALTER TABLE model_instances DROP CONSTRAINT model_instances_profile_key_uq;
CREATE UNIQUE INDEX model_instances_profile_key_active_uq
  ON model_instances (model_profile_id, instance_key)
  WHERE deleted_at IS NULL;

-- NULL project scopes need their own unique index because ordinary PostgreSQL unique indexes treat NULLs as distinct.
DROP INDEX documents_active_content_hash_uq;
CREATE UNIQUE INDEX documents_project_content_hash_uq
  ON documents (owner_user_id, project_id, content_sha256)
  WHERE project_id IS NOT NULL AND content_sha256 IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX documents_user_content_hash_uq
  ON documents (owner_user_id, content_sha256)
  WHERE project_id IS NULL AND content_sha256 IS NOT NULL AND deleted_at IS NULL;

-- A chat profile needs explicit limits for context budgeting and output reservation.
ALTER TABLE model_profiles
  ADD CONSTRAINT model_profiles_chat_limits_ck
  CHECK (model_type <> 'chat' OR (context_window_tokens IS NOT NULL AND max_output_tokens IS NOT NULL));
