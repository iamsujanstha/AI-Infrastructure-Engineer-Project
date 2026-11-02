export class ConversationNotFoundError extends Error {
  constructor() {
    super('Conversation not found');
    this.name = 'ConversationNotFoundError';
  }
}

export class MessageNotFoundError extends Error {
  constructor() {
    super('Message not found');
    this.name = 'MessageNotFoundError';
  }
}

export class InvalidConversationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConversationStateError';
  }
}

export class InvalidMessageStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMessageStateError';
  }
}
