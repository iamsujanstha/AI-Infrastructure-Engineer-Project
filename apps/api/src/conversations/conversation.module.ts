import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ConversationRepository, MessageRepository } from './conversation.repository';
import { ConversationService, MessageService } from './conversation.service';

@Module({
  imports: [DatabaseModule],
  providers: [ConversationRepository, MessageRepository, ConversationService, MessageService],
  exports: [ConversationService, MessageService],
})
export class ConversationModule {}
