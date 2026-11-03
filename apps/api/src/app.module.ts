import { Module } from '@nestjs/common';
import { ConfigurationModule } from './config/configuration.module';
import { AppController } from './app.controller';
import { HealthModule } from './health/health.module';
import { ConversationModule } from './conversations/conversation.module';
import { ChatModule } from './chat/chat.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [ConfigurationModule, HealthModule, ConversationModule, ChatModule, SystemModule],
  controllers: [AppController],
})
export class AppModule {}
