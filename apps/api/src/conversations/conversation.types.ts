export type ConversationStatus = 'active' | 'archived';
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type MessageStatus = 'streaming' | 'complete' | 'failed' | 'cancelled';
export type GenerationKind = 'original' | 'retry' | 'regeneration';

export interface ConversationRecord {
  id: string;
  ownerUserId: string;
  projectId: string | null;
  title: string;
  status: ConversationStatus;
  version: string;
  nextMessageSequence: string;
  lastMessageAt: Date;
  parentConversationId: string | null;
  forkedFromMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRecord {
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
  parts: MessagePartRecord[];
}

export interface MessagePartRecord {
  id: string;
  partIndex: number;
  partType: string;
  textContent: string | null;
  data: Record<string, unknown> | null;
  storageKey: string | null;
}

export interface MessagePage {
  messages: MessageRecord[];
  nextAfterSequence: string | null;
}
