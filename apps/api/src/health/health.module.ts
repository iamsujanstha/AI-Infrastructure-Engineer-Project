import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { HealthController } from './health.controller';

import { ContextEngineModule } from '../context-engine/context-engine.module';

@Module({
  imports: [DatabaseModule, RedisModule, ContextEngineModule],
  controllers: [HealthController],
})
export class HealthModule {}
