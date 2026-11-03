import { Module } from '@nestjs/common';
import { ConfigurationModule } from './config/configuration.module';
import { AppController } from './app.controller';
import { HealthModule } from './health/health.module';
import { ConversationModule } from './conversations/conversation.module';

@Module({
  imports: [ConfigurationModule, HealthModule, ConversationModule],
  controllers: [AppController],
})
export class AppModule {}
