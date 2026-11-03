import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../config/configuration.module';
import { LocalChatOriginGuard } from '../auth/local-chat-origin.guard';
import { ConversationModule } from '../conversations/conversation.module';
import { DatabaseModule } from '../database/database.module';
import { InferenceModule } from '../inference/inference.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { LocalChatOwner } from './local-chat-owner';
import { LocalConversationChatService } from './local-conversation-chat.service';

@Module({
  imports: [ConfigurationModule, InferenceModule, DatabaseModule, ConversationModule],
  controllers: [ChatController],
  providers: [ChatService, LocalChatOriginGuard, LocalChatOwner, LocalConversationChatService],
})
export class ChatModule {}
