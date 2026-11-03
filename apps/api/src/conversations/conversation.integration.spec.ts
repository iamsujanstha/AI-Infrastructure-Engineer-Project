import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import dotenv from 'dotenv';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { parseEnvironment } from '../config/environment';
import { createPostgresPool } from '../database/pool';
import { ConversationNotFoundError, InvalidConversationStateError } from './conversation.errors';
import { ConversationService, MessageService } from './conversation.service';

const integrationEnabled = process.env.RUN_DATABASE_INTEGRATION === '1';

describe.skipIf(!integrationEnabled)('conversation persistence integration', () => {
  it('persists turns and partial output, applies lifecycle rules, and branches a scoped history snapshot', async () => {
    dotenv.config({ path: resolve(process.cwd(), '.env'), override: false });
    const environment = parseEnvironment(process.env);
    const pool = createPostgresPool(environment);
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const conversations = app.get(ConversationService);
    const messages = app.get(MessageService);
    const suffix = randomUUID();
    let ownerId: string | undefined;
    let otherOwnerId: string | undefined;
    let conversationId: string | undefined;
    let branchId: string | undefined;

    try {
      const owner = await pool.query<{ id: string }>('INSERT INTO users(email) VALUES ($1) RETURNING id', [`conversation-${suffix}@example.test`]);
      ownerId = owner.rows[0]!.id;
      const other = await pool.query<{ id: string }>('INSERT INTO users(email) VALUES ($1) RETURNING id', [`conversation-other-${suffix}@example.test`]);
      otherOwnerId = other.rows[0]!.id;

      const conversation = await conversations.create(ownerId, { title: 'Conversation integration' });
      conversationId = conversation.id;
      await expect(conversations.get(otherOwnerId, conversationId)).rejects.toBeInstanceOf(ConversationNotFoundError);

      const firstTurn = await messages.startTurn(ownerId, conversationId, '  Explain durable history.  ');
      expect(firstTurn.userMessage.sequence).toBe('1');
      expect(firstTurn.userMessage.parts[0]?.id).not.toBe('');
      expect(firstTurn.assistantMessage.status).toBe('streaming');
      await expect(pool.query(
        `INSERT INTO messages (conversation_id, owner_user_id, sequence, role, status, finalized_at, reply_to_message_id)
         VALUES ($1, $2, 999999, 'assistant', 'streaming', NULL, $3)`,
        [conversationId, ownerId, firstTurn.userMessage.id],
      )).rejects.toMatchObject({ code: '23505' });
      await expect(messages.startTurn(ownerId, conversationId, 'Concurrent turn'))
        .rejects.toBeInstanceOf(InvalidConversationStateError);
      await messages.appendAssistantDelta(ownerId, conversationId, firstTurn.assistantMessage.id, 'Partial ');
      await messages.appendAssistantDelta(ownerId, conversationId, firstTurn.assistantMessage.id, 'answer.');
      const firstPage = await messages.list(ownerId, conversationId);
      expect(firstPage.messages[1]?.parts[0]?.textContent).toBe('Partial answer.');
      await messages.complete(ownerId, conversationId, firstTurn.assistantMessage.id);

      const regenerated = await messages.regenerate(ownerId, conversationId, firstTurn.assistantMessage.id);
      expect(regenerated.generationKind).toBe('regeneration');
      expect(regenerated.generationAttempt).toBe(2);
      await messages.appendAssistantDelta(ownerId, conversationId, regenerated.id, 'Alternate answer.');
      await messages.complete(ownerId, conversationId, regenerated.id);

      const secondTurn = await messages.startTurn(ownerId, conversationId, 'Retry this turn.');
      await messages.appendAssistantDelta(ownerId, conversationId, secondTurn.assistantMessage.id, 'Incomplete');
      await messages.fail(ownerId, conversationId, secondTurn.assistantMessage.id);
      const retry = await messages.retry(ownerId, conversationId, secondTurn.assistantMessage.id);
      expect(retry.generationKind).toBe('retry');
      expect(retry.generationAttempt).toBe(2);
      await messages.appendAssistantDelta(ownerId, conversationId, retry.id, 'Canceled partial.');
      await messages.cancel(ownerId, conversationId, retry.id);
      const retryAfterCancel = await messages.retry(ownerId, conversationId, retry.id);
      expect(retryAfterCancel.generationAttempt).toBe(3);
      await messages.appendAssistantDelta(ownerId, conversationId, retryAfterCancel.id, 'Recovered.');
      await messages.complete(ownerId, conversationId, retryAfterCancel.id);

      const branch = await conversations.branch(ownerId, conversationId, regenerated.id);
      branchId = branch.id;
      expect(branch.parentConversationId).toBe(conversationId);
      expect(branch.forkedFromMessageId).toBe(regenerated.id);
      const branchPage = await messages.list(ownerId, branch.id);
      expect(branchPage.messages.map((message) => message.sequence)).toEqual(['1', '2', '3']);
      expect(branchPage.messages[2]?.replyToMessageId).toBe(branchPage.messages[0]?.id);
      expect(branchPage.messages[2]?.parts[0]?.textContent).toBe('Alternate answer.');

      const renamed = await conversations.rename(ownerId, conversationId, 'Renamed');
      expect(renamed.title).toBe('Renamed');
      const archived = await conversations.archive(ownerId, conversationId);
      expect(archived.status).toBe('archived');
      await expect(messages.startTurn(ownerId, conversationId, 'No longer active'))
        .rejects.toBeInstanceOf(InvalidConversationStateError);
    } finally {
      if (branchId) await removeConversation(pool, branchId);
      if (conversationId) await removeConversation(pool, conversationId);
      if (ownerId) await pool.query('DELETE FROM users WHERE id = $1', [ownerId]);
      if (otherOwnerId) await pool.query('DELETE FROM users WHERE id = $1', [otherOwnerId]);
      await app.close();
      await pool.end();
    }
  });
});

async function removeConversation(pool: ReturnType<typeof createPostgresPool>, conversationId: string): Promise<void> {
  const messages = await pool.query<{ id: string }>(
    'SELECT id FROM messages WHERE conversation_id = $1 ORDER BY sequence DESC',
    [conversationId],
  );
  for (const message of messages.rows) await pool.query('DELETE FROM messages WHERE id = $1', [message.id]);
  await pool.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
}
