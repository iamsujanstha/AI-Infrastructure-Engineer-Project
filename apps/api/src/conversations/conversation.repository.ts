import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresService } from '../database/postgres.service';
import { ConversationNotFoundError, InvalidConversationStateError, InvalidMessageStateError, MessageNotFoundError } from './conversation.errors';
import type { ConversationRecord, GenerationKind, MessagePage, MessageRecord, MessageRole, MessageStatus } from './conversation.types';

interface ConversationRow extends QueryResultRow, ConversationRecord {}
interface MessageRow extends QueryResultRow {
  id: string;
  conversationId: string;
  ownerUserId: string;
  sequence: string;
  role: MessageRole;
  status: MessageStatus;
  providerMessageId: string | null;
  metadata: Record<string, unknown>;
  replyToMessageId: string | null;
  generationAttempt: number;
  generationKind: GenerationKind;
  createdAt: Date;
  finalizedAt: Date | null;
}

interface MessagePartRow extends QueryResultRow {
  id: string;
  messageId: string;
  partIndex: number;
  partType: string;
  textContent: string | null;
  data: Record<string, unknown> | null;
  storageKey: string | null;
}

const conversationColumns = `id, owner_user_id AS "ownerUserId", project_id AS "projectId",
  title, status, version::text AS version, next_message_sequence::text AS "nextMessageSequence",
  last_message_at AS "lastMessageAt", parent_conversation_id AS "parentConversationId",
  forked_from_message_id AS "forkedFromMessageId", created_at AS "createdAt", updated_at AS "updatedAt"`;

const messageColumns = `id, conversation_id AS "conversationId", owner_user_id AS "ownerUserId",
  sequence::text AS sequence, role, status, provider_message_id AS "providerMessageId", metadata,
  reply_to_message_id AS "replyToMessageId", generation_attempt AS "generationAttempt",
  generation_kind AS "generationKind", created_at AS "createdAt", finalized_at AS "finalizedAt"`;

@Injectable()
export class ConversationRepository {
  constructor(@Inject(PostgresService) private readonly database: PostgresService) {}

  async list(ownerUserId: string, limit = 50): Promise<ConversationRecord[]> {
    const result = await this.database.query<ConversationRow>(
      `SELECT ${conversationColumns} FROM conversations
       WHERE owner_user_id = $1 AND deleted_at IS NULL AND status = 'active'
       ORDER BY last_message_at DESC, id DESC LIMIT $2`,
      [ownerUserId, limit],
    );
    return result.rows;
  }

  async create(ownerUserId: string, title: string, projectId: string | null): Promise<ConversationRecord> {
    const result = await this.database.query<ConversationRow>(
      `INSERT INTO conversations (owner_user_id, title, project_id)
       VALUES ($1, $2, $3) RETURNING ${conversationColumns}`,
      [ownerUserId, title, projectId],
    );
    return result.rows[0]!;
  }

  async get(ownerUserId: string, conversationId: string): Promise<ConversationRecord> {
    const result = await this.database.query<ConversationRow>(
      `SELECT ${conversationColumns} FROM conversations
       WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
      [conversationId, ownerUserId],
    );
    if (!result.rows[0]) throw new ConversationNotFoundError();
    return result.rows[0];
  }

  async rename(ownerUserId: string, conversationId: string, title: string): Promise<ConversationRecord> {
    const result = await this.database.query<ConversationRow>(
      `UPDATE conversations SET title = $3, updated_at = clock_timestamp(), version = version + 1
       WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL
       RETURNING ${conversationColumns}`,
      [conversationId, ownerUserId, title],
    );
    if (!result.rows[0]) throw new ConversationNotFoundError();
    return result.rows[0];
  }

  async archive(ownerUserId: string, conversationId: string): Promise<ConversationRecord> {
    const result = await this.database.query<ConversationRow>(
      `UPDATE conversations SET status = 'archived', updated_at = clock_timestamp(), version = version + 1
       WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL
       RETURNING ${conversationColumns}`,
      [conversationId, ownerUserId],
    );
    if (!result.rows[0]) throw new ConversationNotFoundError();
    return result.rows[0];
  }

  async branch(ownerUserId: string, conversationId: string, throughMessageId: string): Promise<ConversationRecord> {
    return this.database.withTransaction(async (client) => {
      const sourceResult = await client.query<ConversationRow>(
        `SELECT ${conversationColumns} FROM conversations
         WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [conversationId, ownerUserId],
      );
      const source = sourceResult.rows[0];
      if (!source) throw new ConversationNotFoundError();

      const forkResult = await client.query<MessageRow>(
        `SELECT ${messageColumns} FROM messages
         WHERE id = $1 AND conversation_id = $2 AND owner_user_id = $3 AND status <> 'streaming'`,
        [throughMessageId, conversationId, ownerUserId],
      );
      const forkMessage = forkResult.rows[0];
      if (!forkMessage) throw new MessageNotFoundError();

      const unfinished = await client.query<{ id: string }>(
        `SELECT id FROM messages
         WHERE conversation_id = $1 AND owner_user_id = $2 AND sequence <= $3 AND status = 'streaming'
         FOR UPDATE`,
        [conversationId, ownerUserId, forkMessage.sequence],
      );
      if (unfinished.rows.length > 0) throw new InvalidConversationStateError('A branch cannot snapshot unfinished assistant output.');

      const branchResult = await client.query<ConversationRow>(
        `INSERT INTO conversations (owner_user_id, project_id, title, parent_conversation_id, forked_from_message_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${conversationColumns}`,
        [ownerUserId, source.projectId, `${source.title.slice(0, 188)} (branch)`, conversationId, throughMessageId],
      );
      const branch = branchResult.rows[0]!;

      const history = await client.query<MessageRow>(
        `SELECT ${messageColumns} FROM messages
         WHERE conversation_id = $1 AND owner_user_id = $2 AND sequence <= $3
         ORDER BY sequence`,
        [conversationId, ownerUserId, forkMessage.sequence],
      );
      const partsResult = await client.query<MessagePartRow>(
        `SELECT p.id, p.message_id AS "messageId", p.part_index AS "partIndex", p.part_type AS "partType",
                p.text_content AS "textContent", p.data, p.storage_key AS "storageKey"
         FROM message_parts p JOIN messages m ON m.id = p.message_id
         WHERE m.conversation_id = $1 AND m.owner_user_id = $2 AND m.sequence <= $3
         ORDER BY m.sequence, p.part_index`,
        [conversationId, ownerUserId, forkMessage.sequence],
      );
      const remapped = new Map<string, string>();
      let sequence = 1;
      for (const message of history.rows) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO messages (
             conversation_id, owner_user_id, sequence, role, status, provider_message_id, metadata,
             finalized_at, reply_to_message_id, generation_attempt, generation_kind
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [branch.id, ownerUserId, sequence++, message.role, message.status, message.providerMessageId,
            message.metadata, message.finalizedAt, message.replyToMessageId ? remapped.get(message.replyToMessageId) ?? null : null,
            message.generationAttempt, message.generationKind],
        );
        const newId = inserted.rows[0]!.id;
        remapped.set(message.id, newId);
        for (const part of partsResult.rows.filter((candidate) => candidate.messageId === message.id)) {
          await client.query(
            `INSERT INTO message_parts (message_id, conversation_id, owner_user_id, part_index, part_type, text_content, data, storage_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [newId, branch.id, ownerUserId, part.partIndex, part.partType, part.textContent, part.data, part.storageKey],
          );
        }
      }
      const update = await client.query<ConversationRow>(
        `UPDATE conversations SET next_message_sequence = $2, last_message_at = clock_timestamp(),
            updated_at = clock_timestamp(), version = version + 1
         WHERE id = $1 RETURNING ${conversationColumns}`,
        [branch.id, sequence],
      );
      return update.rows[0]!;
    });
  }
}

@Injectable()
export class MessageRepository {
  constructor(@Inject(PostgresService) private readonly database: PostgresService) {}

  async list(ownerUserId: string, conversationId: string, afterSequence: string | null, limit: number): Promise<MessagePage> {
    const conversation = await this.database.query<{ id: string }>(
      `SELECT id FROM conversations WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
      [conversationId, ownerUserId],
    );
    if (!conversation.rows[0]) throw new ConversationNotFoundError();
    const result = await this.database.query<MessageRow>(
      `SELECT ${messageColumns} FROM messages
       WHERE conversation_id = $1 AND owner_user_id = $2 AND ($3::bigint IS NULL OR sequence > $3::bigint)
       ORDER BY sequence LIMIT $4`,
      [conversationId, ownerUserId, afterSequence, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const ids = rows.map((row) => row.id);
    const parts = ids.length === 0 ? [] : (await this.database.query<MessagePartRow>(
      `SELECT id, message_id AS "messageId", part_index AS "partIndex", part_type AS "partType",
              text_content AS "textContent", data, storage_key AS "storageKey"
       FROM message_parts WHERE message_id = ANY($1::uuid[]) ORDER BY message_id, part_index`,
      [ids],
    )).rows;
    const messages: MessageRecord[] = rows.map((row) => ({
      ...row,
      parts: parts.filter((part) => part.messageId === row.id).map(({ messageId: _messageId, ...part }) => part),
    }));
    return { messages, nextAfterSequence: hasMore ? rows.at(-1)?.sequence ?? null : null };
  }

  async listRecent(ownerUserId: string, conversationId: string, limit: number): Promise<MessageRecord[]> {
    const conversation = await this.database.query<{ id: string }>(
      `SELECT id FROM conversations WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
      [conversationId, ownerUserId],
    );
    if (!conversation.rows[0]) throw new ConversationNotFoundError();
    const rows = (await this.database.query<MessageRow>(
      `SELECT ${messageColumns} FROM messages
       WHERE conversation_id = $1 AND owner_user_id = $2 ORDER BY sequence DESC LIMIT $3`,
      [conversationId, ownerUserId, limit],
    )).rows.reverse();
    const ids = rows.map((row) => row.id);
    const parts = ids.length === 0 ? [] : (await this.database.query<MessagePartRow>(
      `SELECT id, message_id AS "messageId", part_index AS "partIndex", part_type AS "partType",
              text_content AS "textContent", data, storage_key AS "storageKey"
       FROM message_parts WHERE message_id = ANY($1::uuid[]) ORDER BY message_id, part_index`,
      [ids],
    )).rows;
    return rows.map((row) => ({
      ...row,
      parts: parts.filter((part) => part.messageId === row.id).map(({ messageId: _messageId, ...part }) => part),
    }));
  }

  async appendAssistantDelta(ownerUserId: string, conversationId: string, messageId: string, text: string): Promise<void> {
    if (text.length === 0) return;
    await this.database.withTransaction(async (client) => {
      const message = await this.requireStreamingAssistant(client, ownerUserId, conversationId, messageId);
      await client.query(
        `INSERT INTO message_parts (message_id, conversation_id, owner_user_id, part_index, part_type, text_content)
         VALUES ($1, $2, $3, 0, 'text', $4)
         ON CONFLICT (message_id, part_index) DO UPDATE
         SET text_content = message_parts.text_content || EXCLUDED.text_content`,
        [message.id, conversationId, ownerUserId, text],
      );
    });
  }

  async finalize(ownerUserId: string, conversationId: string, messageId: string, status: Exclude<MessageStatus, 'streaming'>): Promise<MessageRecord> {
    return this.database.withTransaction(async (client) => {
      const result = await client.query<MessageRow>(
        `UPDATE messages SET status = $4, finalized_at = clock_timestamp()
         WHERE id = $1 AND conversation_id = $2 AND owner_user_id = $3 AND role = 'assistant' AND status = 'streaming'
         RETURNING ${messageColumns}`,
        [messageId, conversationId, ownerUserId, status],
      );
      if (result.rows[0]) return { ...result.rows[0], parts: await this.parts(client, messageId) };
      const current = await this.findMessage(client, ownerUserId, conversationId, messageId);
      if (!current) throw new MessageNotFoundError();
      if (current.role !== 'assistant') throw new InvalidMessageStateError('Only assistant messages can be finalized by generation.');
      if (current.status === status) return { ...current, parts: await this.parts(client, messageId) };
      throw new InvalidMessageStateError(`Cannot change a ${current.status} message to ${status}.`);
    });
  }

  async startTurn(ownerUserId: string, conversationId: string, content: string, title?: string): Promise<{ userMessage: MessageRecord; assistantMessage: MessageRecord }> {
    return this.database.withTransaction(async (client) => {
      const conversation = await this.lockActiveConversation(client, ownerUserId, conversationId);
      await this.assertNoStreamingMessage(client, conversationId, ownerUserId);
      const allocation = await client.query<{ firstSequence: string }>(
        `UPDATE conversations SET next_message_sequence = next_message_sequence + 2,
            title = CASE WHEN next_message_sequence = 1 AND $2::text IS NOT NULL THEN $2 ELSE title END,
            last_message_at = clock_timestamp(), updated_at = clock_timestamp(), version = version + 1
         WHERE id = $1 RETURNING (next_message_sequence - 2)::text AS "firstSequence"`,
        [conversation.id, title ?? null],
      );
      const firstSequence = BigInt(allocation.rows[0]!.firstSequence);
      const user = await this.insertMessage(client, {
        conversationId, ownerUserId, sequence: firstSequence, role: 'user', status: 'complete',
        replyToMessageId: null, generationAttempt: 1, generationKind: 'original',
      });
      await client.query(
        `INSERT INTO message_parts (message_id, conversation_id, owner_user_id, part_index, part_type, text_content)
         VALUES ($1, $2, $3, 0, 'text', $4)`,
        [user.id, conversationId, ownerUserId, content],
      );
      const userParts = await this.parts(client, user.id);
      const assistant = await this.insertMessage(client, {
        conversationId, ownerUserId, sequence: firstSequence + 1n, role: 'assistant', status: 'streaming',
        replyToMessageId: user.id, generationAttempt: 1, generationKind: 'original',
      });
      return {
        userMessage: { ...user, parts: userParts },
        assistantMessage: { ...assistant, parts: [] },
      };
    });
  }

  async retry(ownerUserId: string, conversationId: string, failedAssistantId: string): Promise<MessageRecord> {
    return this.startNewGeneration(ownerUserId, conversationId, failedAssistantId, 'retry');
  }

  async regenerate(ownerUserId: string, conversationId: string, completedAssistantId: string): Promise<MessageRecord> {
    return this.startNewGeneration(ownerUserId, conversationId, completedAssistantId, 'regeneration');
  }

  private async startNewGeneration(ownerUserId: string, conversationId: string, sourceAssistantId: string, kind: 'retry' | 'regeneration'): Promise<MessageRecord> {
    return this.database.withTransaction(async (client) => {
      const sourceResult = await client.query<MessageRow>(
        `SELECT ${messageColumns} FROM messages
         WHERE id = $1 AND conversation_id = $2 AND owner_user_id = $3 AND role = 'assistant' FOR UPDATE`,
        [sourceAssistantId, conversationId, ownerUserId],
      );
      const source = sourceResult.rows[0];
      if (!source) throw new MessageNotFoundError();
      const allowed = kind === 'retry' ? ['failed', 'cancelled'] : ['complete'];
      if (!allowed.includes(source.status)) throw new InvalidMessageStateError(`Cannot ${kind} an assistant message in ${source.status} state.`);
      if (!source.replyToMessageId) throw new InvalidMessageStateError('Assistant message has no source user message.');
      const conversation = await this.lockActiveConversation(client, ownerUserId, conversationId);
      await this.assertNoStreamingMessage(client, conversationId, ownerUserId);
      const input = await client.query<{ id: string }>(
        `SELECT id FROM messages WHERE id = $1 AND conversation_id = $2 AND owner_user_id = $3 AND role = 'user' FOR UPDATE`,
        [source.replyToMessageId, conversationId, ownerUserId],
      );
      if (!input.rows[0]) throw new InvalidMessageStateError('Assistant source must reference a user message in this conversation.');
      const attemptResult = await client.query<{ nextAttempt: number }>(
        `SELECT COALESCE(MAX(generation_attempt), 0) + 1 AS "nextAttempt"
         FROM messages WHERE reply_to_message_id = $1 AND conversation_id = $2 AND owner_user_id = $3`,
        [source.replyToMessageId, conversationId, ownerUserId],
      );
      const allocation = await client.query<{ sequence: string }>(
        `UPDATE conversations SET next_message_sequence = next_message_sequence + 1,
            last_message_at = clock_timestamp(), updated_at = clock_timestamp(), version = version + 1
         WHERE id = $1 RETURNING (next_message_sequence - 1)::text AS sequence`,
        [conversation.id],
      );
      return this.insertMessage(client, {
        conversationId, ownerUserId, sequence: BigInt(allocation.rows[0]!.sequence), role: 'assistant',
        status: 'streaming', replyToMessageId: source.replyToMessageId,
        generationAttempt: attemptResult.rows[0]!.nextAttempt, generationKind: kind,
      });
    });
  }

  private async insertMessage(client: PoolClient, input: {
    conversationId: string; ownerUserId: string; sequence: bigint; role: MessageRole; status: MessageStatus;
    replyToMessageId: string | null; generationAttempt: number; generationKind: GenerationKind;
  }): Promise<MessageRecord> {
    const result = await client.query<MessageRow>(
      `INSERT INTO messages (conversation_id, owner_user_id, sequence, role, status, finalized_at,
          reply_to_message_id, generation_attempt, generation_kind)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 'streaming' THEN NULL ELSE clock_timestamp() END, $6, $7, $8)
       RETURNING ${messageColumns}`,
      [input.conversationId, input.ownerUserId, input.sequence.toString(), input.role, input.status,
        input.replyToMessageId, input.generationAttempt, input.generationKind],
    );
    return { ...result.rows[0]!, parts: [] };
  }

  private async lockActiveConversation(client: PoolClient, ownerUserId: string, conversationId: string): Promise<{ id: string }> {
    const result = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM conversations WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [conversationId, ownerUserId],
    );
    const conversation = result.rows[0];
    if (!conversation) throw new ConversationNotFoundError();
    if (conversation.status !== 'active') throw new InvalidConversationStateError('Archived conversations cannot receive messages.');
    return conversation;
  }

  private async assertNoStreamingMessage(client: PoolClient, conversationId: string, ownerUserId: string): Promise<void> {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM messages WHERE conversation_id = $1 AND owner_user_id = $2 AND status = 'streaming' LIMIT 1`,
      [conversationId, ownerUserId],
    );
    if (result.rows[0]) throw new InvalidConversationStateError('This conversation already has an assistant response in progress.');
  }

  private async requireStreamingAssistant(client: PoolClient, ownerUserId: string, conversationId: string, messageId: string): Promise<{ id: string }> {
    const result = await client.query<{ id: string; role: string; status: string }>(
      `SELECT id, role, status FROM messages WHERE id = $1 AND conversation_id = $2 AND owner_user_id = $3 FOR UPDATE`,
      [messageId, conversationId, ownerUserId],
    );
    const message = result.rows[0];
    if (!message) throw new MessageNotFoundError();
    if (message.role !== 'assistant' || message.status !== 'streaming') {
      throw new InvalidMessageStateError('Text can only be appended to a streaming assistant message.');
    }
    return message;
  }

  private async findMessage(client: PoolClient, ownerUserId: string, conversationId: string, messageId: string): Promise<MessageRow | undefined> {
    const result = await client.query<MessageRow>(
      `SELECT ${messageColumns} FROM messages WHERE id = $1 AND conversation_id = $2 AND owner_user_id = $3`,
      [messageId, conversationId, ownerUserId],
    );
    return result.rows[0];
  }

  private async parts(client: PoolClient, messageId: string): Promise<MessageRecord['parts']> {
    const result = await client.query<MessagePartRow>(
      `SELECT id, part_index AS "partIndex", part_type AS "partType", text_content AS "textContent", data, storage_key AS "storageKey"
       FROM message_parts WHERE message_id = $1 ORDER BY part_index`,
      [messageId],
    );
    return result.rows;
  }
}
