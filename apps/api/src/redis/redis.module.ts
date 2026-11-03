import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../config/configuration.module';
import { RedisService } from './redis.service';

@Module({
  imports: [ConfigurationModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
