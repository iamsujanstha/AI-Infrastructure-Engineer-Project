import { Inject, Injectable } from '@nestjs/common';
import { ConversationRepository, MessageRepository } from './conversation.repository';
import type { ConversationRecord, MessagePage, MessageRecord } from './conversation.types';

@Injectable()
export class ConversationService {
  constructor(@Inject(ConversationRepository) private readonly conversations: ConversationRepository) {}

  create(ownerUserId: string, input: { title?: string; projectId?: string | null }): Promise<ConversationRecord> {
    return this.conversations.create(ownerUserId, normalizeTitle(input.title), input.projectId ?? null);
  }

  rename(ownerUserId: string, conversationId: string, title: string): Promise<ConversationRecord> {
    return this.conversations.rename(ownerUserId, conversationId, normalizeTitle(title));
  }

  archive(ownerUserId: string, conversationId: string): Promise<ConversationRecord> {
    return this.conversations.archive(ownerUserId, conversationId);
  }

  get(ownerUserId: string, conversationId: string): Promise<ConversationRecord> {
    return this.conversations.get(ownerUserId, conversationId);
  }

  branch(ownerUserId: string, conversationId: string, throughMessageId: string): Promise<ConversationRecord> {
    return this.conversations.branch(ownerUserId, conversationId, throughMessageId);
  }
}

@Injectable()
export class MessageService {
  constructor(@Inject(MessageRepository) private readonly messages: MessageRepository) {}

  list(ownerUserId: string, conversationId: string, options: { afterSequence?: string; limit?: number } = {}): Promise<MessagePage> {
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Message page limit must be between 1 and 100.');
    const afterSequence = options.afterSequence ?? null;
    if (afterSequence !== null && (!/^\d+$/.test(afterSequence) || BigInt(afterSequence) < 0n)) {
      throw new RangeError('Message cursor must be a nonnegative sequence number.');
    }
    return this.messages.list(ownerUserId, conversationId, afterSequence, limit);
  }

  startTurn(ownerUserId: string, conversationId: string, content: string): Promise<{ userMessage: MessageRecord; assistantMessage: MessageRecord }> {
    const normalized = content.trim();
    if (normalized.length === 0 || normalized.length > 32_000) {
      throw new RangeError('User message must contain between 1 and 32000 characters.');
    }
    return this.messages.startTurn(ownerUserId, conversationId, normalized);
  }

  appendAssistantDelta(ownerUserId: string, conversationId: string, messageId: string, text: string): Promise<void> {
    if (text.length > 16_000) throw new RangeError('A persisted assistant delta cannot exceed 16000 characters.');
    return this.messages.appendAssistantDelta(ownerUserId, conversationId, messageId, text);
  }

  complete(ownerUserId: string, conversationId: string, messageId: string): Promise<MessageRecord> {
    return this.messages.finalize(ownerUserId, conversationId, messageId, 'complete');
  }

  fail(ownerUserId: string, conversationId: string, messageId: string): Promise<MessageRecord> {
    return this.messages.finalize(ownerUserId, conversationId, messageId, 'failed');
  }

  cancel(ownerUserId: string, conversationId: string, messageId: string): Promise<MessageRecord> {
    return this.messages.finalize(ownerUserId, conversationId, messageId, 'cancelled');
  }

  retry(ownerUserId: string, conversationId: string, failedAssistantId: string): Promise<MessageRecord> {
    return this.messages.retry(ownerUserId, conversationId, failedAssistantId);
  }

  regenerate(ownerUserId: string, conversationId: string, completedAssistantId: string): Promise<MessageRecord> {
    return this.messages.regenerate(ownerUserId, conversationId, completedAssistantId);
  }
}

function normalizeTitle(title: string | undefined): string {
  const normalized = title?.trim() || 'New conversation';
  if (normalized.length > 200) throw new RangeError('Conversation title cannot exceed 200 characters.');
  return normalized;
}
