import { Controller, Get, HttpStatus, Inject, Req, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AppEnvironment } from '../config/environment';
import { PostgresService } from '../database/postgres.service';
import { RedisService } from '../redis/redis.service';

import { ContextEngineClient, ContextEngineRequestError } from '../context-engine/context-engine.client';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    @Inject(PostgresService) private readonly database: PostgresService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ContextEngineClient) private readonly engine: ContextEngineClient,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  @Get()
  liveness(): { status: 'ok'; service: string } {
    return { status: 'ok', service: 'local-ai-platform-api' };
  }

  @Get('database')
  async databaseReadiness(@Res({ passthrough: true }) response: Response): Promise<Record<string, string | number>> {
    try {
      await this.database.checkConnection();
      return { status: 'ok', dependency: 'postgres' };
    } catch {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { statusCode: HttpStatus.SERVICE_UNAVAILABLE, status: 'unavailable', dependency: 'postgres' };
    }
  }

  @Get('redis')
  async redisReadiness(@Res({ passthrough: true }) response: Response): Promise<Record<string, string | number>> {
    try {
      await this.redis.checkConnection();
      return { status: 'ok', dependency: 'redis' };
    } catch {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { statusCode: HttpStatus.SERVICE_UNAVAILABLE, status: 'unavailable', dependency: 'redis' };
    }
  }

  @Get('inference')
  async inferenceReadiness(@Res({ passthrough: true }) response: Response): Promise<Record<string, string | number>> {
    const endpoint = this.config.get('INFERENCE_HEALTH_URL', { infer: true });
    if (!endpoint) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { statusCode: HttpStatus.SERVICE_UNAVAILABLE, status: 'not_configured', dependency: 'inference' };
    }

    try {
      const timeout = this.config.get('INFERENCE_HEALTH_TIMEOUT_MS', { infer: true });
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(timeout) });
      if (!response.ok) throw new Error('Inference health endpoint returned a non-success status');
      return { status: 'ok', dependency: 'inference' };
    } catch {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { statusCode: HttpStatus.SERVICE_UNAVAILABLE, status: 'unavailable', dependency: 'inference' };
    }
  }
  @Get('context-engine')
  async engineReadiness(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<Record<string, string | number>> {
    try {
      await this.engine.checkHealth(request);
      return { status: 'ok', dependency: 'context-engine' };
    } catch (error) {
      const timedOut = error instanceof ContextEngineRequestError && error.timedOut;
      const statusCode = timedOut ? 504 : 503;
      response.status(statusCode);
      return { statusCode, status: timedOut ? 'timeout' : 'unavailable', dependency: 'context-engine' };
    }
  }

}
