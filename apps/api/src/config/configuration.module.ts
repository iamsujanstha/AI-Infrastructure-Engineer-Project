import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { parseEnvironment } from './environment';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
      validate: parseEnvironment,
    }),
  ],
})
export class ConfigurationModule {}
