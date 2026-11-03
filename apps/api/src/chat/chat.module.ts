import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../config/configuration.module';
import { LocalChatOriginGuard } from '../auth/local-chat-origin.guard';
import { InferenceModule } from '../inference/inference.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [ConfigurationModule, InferenceModule],
  controllers: [ChatController],
  providers: [ChatService, LocalChatOriginGuard],
})
export class ChatModule {}
