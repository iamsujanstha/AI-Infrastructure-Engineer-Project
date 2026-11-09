import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RequestMethod, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
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
    serializers: { req: (request: { id?: unknown; method?: unknown; url?: unknown }) => ({ id:request.id,method:request.method,
      url:typeof request.url==='string' && request.url.startsWith('/api/v1/cms/oidc/callback') ? '/api/v1/cms/oidc/callback' : request.url }) },
    genReqId: (request) => request.id,
    customLogLevel: (_request, response, error) => {
      if (error) return 'error';
      if (response.statusCode >= 400) return 'warn';
      return 'info';
    },
  }));
  app.use((request: Request, response: Response, next: NextFunction) => {
    // Swagger UI injects a small inline initializer; relax CSP only on the local docs page.
    const docsRequest = request.path === '/docs' || request.path.startsWith('/docs/');
    helmet(docsRequest ? { contentSecurityPolicy: false } : {})(request, response, next);
  });
  app.use(json({ limit: '64kb' }));
  app.use(urlencoded({ extended: false, limit: '64kb' }));
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    credentials: true,
    maxAge: 600,
  });
  app.use(rateLimit({
    windowMs: config.get('RATE_LIMIT_WINDOW_MS', { infer: true }),
    limit: config.get('RATE_LIMIT_MAX_REQUESTS', { infer: true }),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (request) => request.path === '/health' || request.path.startsWith('/health/'),
  }));
  app.use('/api/v1/cms', rateLimit({
    windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    skip: (request) => !['/login', '/setup', '/password','/oidc/start','/oidc/callback'].includes(request.path),
  }));
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/database', method: RequestMethod.GET },
      { path: 'health/redis', method: RequestMethod.GET },
      { path: 'health/inference', method: RequestMethod.GET },
      { path: 'health/context-engine', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new HttpExceptionFilter(logger));
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Local AI Platform API')
    .setDescription(
      'Local development API for chat, saved conversations, and dependency readiness. ' +
      'Chat endpoints are restricted to configured browser origins in loopback or explicitly enabled local Docker development; this origin check is not authentication.',
    )
    .setVersion('1.0.0')
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, openApiDocument, {
    jsonDocumentUrl: 'docs/openapi.json',
    yamlDocumentUrl: 'docs/openapi.yaml',
    customSiteTitle: 'Local AI Platform API',
    swaggerOptions: { displayRequestDuration: true, persistAuthorization: false },
  });

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
