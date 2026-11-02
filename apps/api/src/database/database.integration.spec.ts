import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../config/environment';
import { createPostgresPool } from './pool';

const integrationEnabled = process.env.RUN_DATABASE_INTEGRATION === '1';

describe.skipIf(!integrationEnabled)('PostgreSQL core schema integration', () => {
  it('enforces table coverage, tenant ownership, uniqueness, and vector dimensions', async () => {
    dotenv.config({ path: resolve(process.cwd(), '.env'), override: false });
    const environment = parseEnvironment(process.env);
    const pool = createPostgresPool(environment);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const expectedTables = [
        'users', 'projects', 'model_profiles', 'model_instances', 'conversations', 'messages',
        'message_parts', 'agent_runs', 'tool_calls', 'memories', 'memory_links', 'documents',
        'document_chunks', 'embeddings', 'inference_requests', 'usage_records', 'context_snapshots',
        'summaries', 'jobs', 'audit_logs',
      ];
      const tableResult = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
        [expectedTables],
      );
      expect(new Set(tableResult.rows.map((row) => row.table_name))).toEqual(new Set(expectedTables));

      const uniqueSuffix = randomUUID();
      const owner = await client.query<{ id: string }>(
        'INSERT INTO users(email) VALUES ($1) RETURNING id',
        [`phase2-${uniqueSuffix}@example.test`],
      );
      const secondOwner = await client.query<{ id: string }>(
        'INSERT INTO users(email) VALUES ($1) RETURNING id',
        [`phase2-other-${uniqueSuffix}@example.test`],
      );
      const ownerId = owner.rows[0]?.id;
      const otherOwnerId = secondOwner.rows[0]?.id;
      expect(ownerId).toBeDefined();
      expect(otherOwnerId).toBeDefined();

      const project = await client.query<{ id: string }>(
        'INSERT INTO projects(owner_user_id, slug, name) VALUES ($1, $2, $3) RETURNING id',
        [ownerId, `phase2-${uniqueSuffix}`, 'Phase 2 integration fixture'],
      );
      const projectId = project.rows[0]?.id;
      expect(projectId).toBeDefined();

      await client.query('SAVEPOINT duplicate_email');
      await expect(client.query('INSERT INTO users(email) VALUES ($1)', [`PHASE2-${uniqueSuffix}@example.test`]))
        .rejects.toMatchObject({ code: '23505' });
      await client.query('ROLLBACK TO SAVEPOINT duplicate_email');

      await client.query('SAVEPOINT cross_owner_project');
      await expect(client.query(
        `INSERT INTO conversations(owner_user_id, project_id)
         VALUES ($1, $2)`,
        [otherOwnerId, projectId],
      )).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK TO SAVEPOINT cross_owner_project');

      const memory = await client.query<{ id: string }>(
        `INSERT INTO memories(owner_user_id, project_id, memory_type, title, content, source_type)
         VALUES ($1, $2, 'project', 'Test memory', 'Temporary integration row', 'user_input')
         RETURNING id`,
        [ownerId, projectId],
      );
      const memoryId = memory.rows[0]?.id;
      expect(memoryId).toBeDefined();

      await client.query('SAVEPOINT wrong_vector_dimensions');
      await expect(client.query(
        `INSERT INTO embeddings(owner_user_id, memory_id, embedding_model, dimensions, embedding)
         VALUES ($1, $2, 'test-model', 3, '[0.1, 0.2]'::vector)`,
        [ownerId, memoryId],
      )).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT wrong_vector_dimensions');

      const contentHash = 'a'.repeat(64);
      await client.query(
        `INSERT INTO documents(owner_user_id, title, media_type, storage_key, content_sha256, size_bytes)
         VALUES ($1, 'Test document', 'text/plain', $2, $3, 1)`,
        [ownerId, `phase2/${uniqueSuffix}/doc-1`, contentHash],
      );
      await client.query('SAVEPOINT duplicate_user_document');
      await expect(client.query(
        `INSERT INTO documents(owner_user_id, title, media_type, storage_key, content_sha256, size_bytes)
         VALUES ($1, 'Duplicate document', 'text/plain', $2, $3, 1)`,
        [ownerId, `phase2/${uniqueSuffix}/doc-2`, contentHash],
      )).rejects.toMatchObject({ code: '23505' });
      await client.query('ROLLBACK TO SAVEPOINT duplicate_user_document');

      await client.query('SAVEPOINT missing_chat_limits');
      await expect(client.query(
        `INSERT INTO model_profiles(profile_key, provider_key, model_identifier, model_type)
         VALUES ($1, 'test', 'test-chat', 'chat')`,
        [`phase2-${uniqueSuffix}`],
      )).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT missing_chat_limits');

      const profile = await client.query<{ id: string }>(
        `INSERT INTO model_profiles(profile_key, provider_key, model_identifier, model_type, context_window_tokens, max_output_tokens)
         VALUES ($1, 'test', 'test-chat', 'chat', 8192, 1024) RETURNING id`,
        [`phase2-${uniqueSuffix}`],
      );
      const profileId = profile.rows[0]?.id;
      expect(profileId).toBeDefined();
      await client.query(
        `INSERT INTO model_instances(model_profile_id, instance_key, deleted_at)
         VALUES ($1, 'local', clock_timestamp())`,
        [profileId],
      );
      await client.query(
        `INSERT INTO model_instances(model_profile_id, instance_key)
         VALUES ($1, 'local')`,
        [profileId],
      );

      await client.query('ROLLBACK');
    } finally {
      if (client) client.release();
      await pool.end();
    }
  });
});
