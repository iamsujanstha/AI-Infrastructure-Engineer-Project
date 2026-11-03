import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../config/configuration.module';
import { PostgresService } from './postgres.service';

@Module({
  imports: [ConfigurationModule],
  providers: [PostgresService],
  exports: [PostgresService],
})
export class DatabaseModule {}
