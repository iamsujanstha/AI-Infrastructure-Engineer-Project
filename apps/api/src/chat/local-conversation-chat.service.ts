import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ConversationService, MessageService } from '../conversations/conversation.service';
import type { MessageRecord } from '../conversations/conversation.types';
import { ChatService } from './chat.service';
import { LocalChatOwner } from './local-chat-owner';

const createSchema = z.object({ title: z.string().trim().max(200).optional() }).strict();
const turnSchema = z.object({ model: z.string().min(1).max(250), content: z.string().trim().min(1).max(32_000) }).strict();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class LocalConversationChatService {
  constructor(
    @Inject(LocalChatOwner) private readonly owner: LocalChatOwner,
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(MessageService) private readonly messages: MessageService,
    @Inject(ChatService) private readonly chat: ChatService,
  ) {}

  async list(): Promise<{ conversations: Array<{ id: string; title: string; status: string; lastMessageAt: Date; updatedAt: Date }> }> {
    const ownerId = await this.owner.id();
    const items = await this.conversations.list(ownerId);
    return {
      conversations: items.map(({ id, title, status, lastMessageAt, updatedAt }) => ({ id, title, status, lastMessageAt, updatedAt })),
    };
  }

  async create(input: unknown) {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Conversation request is invalid.');
    const ownerId = await this.owner.id();
    const conversation = await this.conversations.create(ownerId, parsed.data);
    const { id, title, status, lastMessageAt, updatedAt } = conversation;
    return { id, title, status, lastMessageAt, updatedAt };
  }

  async getMessages(conversationId: string) {
    this.assertUuid(conversationId);
    const ownerId = await this.owner.id();
    const page = await this.messages.listRecent(ownerId, conversationId, 100);
    return {
      messages: page.map((message) => this.toClientMessage(message)),
    };
  }

  async send(conversationId: string, input: unknown, requestId: string) {
    this.assertUuid(conversationId);
    const parsed = turnSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Chat turn is invalid.');
    const ownerId = await this.owner.id();
    const previous = await this.messages.listRecent(ownerId, conversationId, 100);
    const user = previous.filter((message) => message.role === 'user');
    const assistantByReply = new Map<string, MessageRecord>();
    for (const message of previous) {
      if (message.role === 'assistant' && message.status === 'complete' && message.replyToMessageId
          && this.content(message).length > 0) assistantByReply.set(message.replyToMessageId, message);
    }
    const history = user.flatMap((userMessage) => {
      const assistant = assistantByReply.get(userMessage.id);
      return assistant ? [
        { role: 'user' as const, content: this.content(userMessage) },
        { role: 'assistant' as const, content: this.content(assistant) },
      ] : [];
    }).slice(-98);

    const title = parsed.data.content.replace(/\s+/g, ' ').trim().slice(0, 72);
    const started = await this.messages.startTurn(ownerId, conversationId, parsed.data.content, title);
    try {
      const completion = await this.chat.complete({
        model: parsed.data.model,
        messages: [...history, { role: 'user', content: parsed.data.content }],
      }, requestId);
      await this.messages.appendAssistantDelta(ownerId, conversationId, started.assistantMessage.id, completion.content);
      const saved = await this.messages.complete(ownerId, conversationId, started.assistantMessage.id);
      return {
        conversationId,
        userMessage: this.toClientMessage(started.userMessage),
        assistantMessage: this.toClientMessage(saved),
        model: completion.model,
        budget: completion.budget,
      };
    } catch (error) {
      // Keep the user turn and a failed assistant record; never make a failed generation look complete.
      await this.messages.fail(ownerId, conversationId, started.assistantMessage.id).catch(() => undefined);
      throw error;
    }
  }

  private assertUuid(value: string): void {
    if (!UUID.test(value)) throw new BadRequestException('Conversation ID is invalid.');
  }

  private content(message: MessageRecord): string {
    return message.parts.filter((part) => part.partType === 'text')
      .map((part) => part.textContent ?? '').join('');
  }

  private toClientMessage(message: MessageRecord) {
    return {
      id: message.id,
      sequence: message.sequence,
      role: message.role,
      status: message.status,
      content: this.content(message),
      createdAt: message.createdAt,
    };
  }
}
