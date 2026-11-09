import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../config/configuration.module';
import { LocalChatOriginGuard } from '../auth/local-chat-origin.guard';
import { LegacyLocalChatGuard } from '../auth/legacy-local-chat.guard';
import { ConversationModule } from '../conversations/conversation.module';
import { DatabaseModule } from '../database/database.module';
import { InferenceModule } from '../inference/inference.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { LocalChatOwner } from './local-chat-owner';
import { LocalConversationChatService } from './local-conversation-chat.service';
import { SuppliedContextService } from './supplied-context.service';
import { SuppliedContextController } from './supplied-context.controller';

@Module({
  imports: [ConfigurationModule, InferenceModule, DatabaseModule, ConversationModule],
  controllers: [ChatController, SuppliedContextController],
  providers: [ChatService, LocalChatOriginGuard, LegacyLocalChatGuard, LocalChatOwner, LocalConversationChatService, SuppliedContextService],
  exports: [ChatService, SuppliedContextService],
})
export class ChatModule {}
