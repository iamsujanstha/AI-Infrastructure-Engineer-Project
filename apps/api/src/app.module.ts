import { Module } from '@nestjs/common';
import { ConfigurationModule } from './config/configuration.module';
import { AppController } from './app.controller';
import { HealthModule } from './health/health.module';

@Module({
  imports: [ConfigurationModule, HealthModule],
  controllers: [AppController],
})
export class AppModule {}
