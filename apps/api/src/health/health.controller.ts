import { Controller, Get, HttpStatus, Inject, Req, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AppEnvironment } from '../config/environment';
import { PostgresService } from '../database/postgres.service';
import { RedisService } from '../redis/redis.service';

import { ContextEngineClient, ContextEngineRequestError } from '../context-engine/context-engine.client';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
@ApiTags('Health')
export class HealthController {
  constructor(
    @Inject(PostgresService) private readonly database: PostgresService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ContextEngineClient) private readonly engine: ContextEngineClient,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Check API process liveness' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok', service: 'local-ai-platform-api' } } })
  liveness(): { status: 'ok'; service: string } {
    return { status: 'ok', service: 'local-ai-platform-api' };
  }

  @Get('database')
  @ApiOperation({ summary: 'Check PostgreSQL readiness' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok', dependency: 'postgres' } } })
  @ApiResponse({ status: 503, schema: { example: { statusCode: 503, status: 'unavailable', dependency: 'postgres' } } })
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
  @ApiOperation({ summary: 'Check Redis readiness' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok', dependency: 'redis' } } })
  @ApiResponse({ status: 503, schema: { example: { statusCode: 503, status: 'unavailable', dependency: 'redis' } } })
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
  @ApiOperation({ summary: 'Check configured inference endpoint readiness' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok', dependency: 'inference' } } })
  @ApiResponse({
    status: 503,
    description: 'Inference health endpoint is not configured or the configured endpoint is unavailable.',
    schema: { example: { statusCode: 503, status: 'not_configured', dependency: 'inference' } },
  })
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
  @ApiOperation({ summary: 'Check authenticated context-engine readiness' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok', dependency: 'context-engine' } } })
  @ApiResponse({ status: 503, description: 'Context engine is unavailable.' })
  @ApiResponse({ status: 504, description: 'Context engine health request timed out.' })
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
