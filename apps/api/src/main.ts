import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RequestMethod, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import type { AppEnvironment } from './config/environment';
import { requestIdMiddleware } from './observability/request-id.middleware';
import { StructuredLogger } from './observability/structured-logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  const config = app.get(ConfigService<AppEnvironment, true>);
  const logger = pino({
    level: config.get('LOG_LEVEL', { infer: true }),
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie'],
      censor: '[REDACTED]',
    },
  });

  app.useLogger(new StructuredLogger(logger));
  app.use(requestIdMiddleware);
  app.use(pinoHttp({
    logger,
    genReqId: (request) => request.id,
    customLogLevel: (_request, response, error) => {
      if (error) return 'error';
      if (response.statusCode >= 400) return 'warn';
      return 'info';
    },
  }));
  app.use(helmet());
  app.use(json({ limit: '64kb' }));
  app.use(urlencoded({ extended: false, limit: '64kb' }));
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    credentials: false,
    maxAge: 600,
  });
  app.use(rateLimit({
    windowMs: config.get('RATE_LIMIT_WINDOW_MS', { infer: true }),
    limit: config.get('RATE_LIMIT_MAX_REQUESTS', { infer: true }),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (request) => request.path === '/health' || request.path.startsWith('/health/'),
  }));
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/database', method: RequestMethod.GET },
      { path: 'health/redis', method: RequestMethod.GET },
      { path: 'health/inference', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new HttpExceptionFilter(logger));
  app.enableShutdownHooks();

  const port = config.get('API_PORT', { infer: true });
  const host = config.get('API_HOST', { infer: true });
  await app.listen(port, host);
  logger.info({ host, port }, 'API listening');
}

void bootstrap().catch((error: unknown) => {
  const logger = pino();
  logger.fatal({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'API bootstrap failed');
  process.exitCode = 1;
});
