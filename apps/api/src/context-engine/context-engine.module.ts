import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../config/configuration.module';
import { ContextEngineClient } from './context-engine.client';

@Module({ imports: [ConfigurationModule], providers: [ContextEngineClient], exports: [ContextEngineClient] })
export class ContextEngineModule {}
