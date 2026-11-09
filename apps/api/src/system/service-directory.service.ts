import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
import type { AppEnvironment } from '../config/environment';
import type { ServiceDirectoryResponseDto } from './service-directory.dto';

function isLoopback(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || (isIP(normalized) === 4 && normalized.startsWith('127.'))
    || (isIP(normalized) === 6 && normalized === '::1');
}

function localUrl(host: string, port: number): string {
  const normalized = host.replace(/^\[|\]$/g, '');
  const formatted = normalized.includes(':') ? `[${normalized}]` : normalized;
  return `http://${formatted}:${port}`;
}

@Injectable()
export class ServiceDirectoryService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>) {}

  getDirectory(): ServiceDirectoryResponseDto {
    const environment = this.config.get('NODE_ENV', { infer: true });
    const apiHost = this.config.get('API_HOST', { infer: true });
    const containerMode = this.config.get('LOCAL_CHAT_CONTAINER_MODE', { infer: true });
    if (environment === 'production' || (!isLoopback(apiHost) && !(containerMode && apiHost === '0.0.0.0'))) {
      throw new NotFoundException('The local service directory is available only in loopback development.');
    }

    const apiUrl = localUrl('127.0.0.1', this.config.get('API_PORT', { infer: true }));
    const databaseUrl = new URL(this.config.get('DATABASE_URL', { infer: true }));
    const redisUrl = new URL(this.config.get('REDIS_URL', { infer: true }));
    const configuredContextEngineUrl = new URL(this.config.get('CONTEXT_ENGINE_PUBLIC_URL', { infer: true }));
    const contextEngineUrl = `${configuredContextEngineUrl.origin}${configuredContextEngineUrl.pathname.replace(/\/$/, '')}`;
    const mlxUrl = this.config.get('MLX_BASE_URL', { infer: true }).replace(/\/$/, '');
    const pgAdminUrl = localUrl('127.0.0.1', this.config.get('PGADMIN_PORT', { infer: true }));
    const pgAdminUser = this.config.get('PGADMIN_DEFAULT_EMAIL', { infer: true });
    const pgDatabase = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
    const pgUsername = decodeURIComponent(databaseUrl.username);

    return {
      scope: 'local_development',
      note: 'Addresses reflect local configuration; they are not health checks. Password values are never returned. pgAdmin credentials are read from .env.',
      services: [
        {
          id: 'web',
          name: 'Web application',
          type: 'web',
          description: 'Next.js chat and control surface.',
          links: { home: 'http://127.0.0.1:3000', docs: null, api: null },
          connection: null,
          login: null,
          launchCommand: null,
        },
        {
          id: 'nest-api',
          name: 'NestJS API',
          type: 'http_api',
          description: 'Chat, conversation persistence, service catalog, and dependency readiness endpoints.',
          links: { home: null, docs: `${apiUrl}/docs`, api: `${apiUrl}/api/v1` },
          connection: null,
          login: null,
          launchCommand: null,
        },
        {
          id: 'postgres',
          name: 'PostgreSQL with pgvector',
          type: 'database',
          description: 'Application database. Use pgAdmin or a PostgreSQL client to inspect it.',
          links: { home: null, docs: null, api: null },
          connection: {
            host: databaseUrl.hostname,
            port: Number(databaseUrl.port || 5432),
            database: pgDatabase,
            username: pgUsername,
            passwordEnvironmentVariable: 'POSTGRES_PASSWORD',
          },
          login: null,
          launchCommand: null,
        },
        {
          id: 'pgadmin',
          name: 'pgAdmin',
          type: 'database_ui',
          description: 'PostgreSQL browser UI. The connection details below use the Compose network address for PostgreSQL.',
          links: { home: pgAdminUrl, docs: null, api: null },
          connection: {
            host: 'postgres',
            port: 5432,
            database: pgDatabase,
            username: pgUsername,
            passwordEnvironmentVariable: 'POSTGRES_PASSWORD',
          },
          login: {
            username: pgAdminUser,
            passwordEnvironmentVariable: 'PGADMIN_DEFAULT_PASSWORD',
            passwordConfiguration: 'Set in .env; if absent, the local-only fallback is in docker-compose.yml.',
          },
          launchCommand: 'docker compose up -d pgadmin',
        },
        {
          id: 'context-engine',
          name: 'FastAPI context engine',
          type: 'http_api',
          description: 'Internal health API only; project scan and retrieval are not HTTP endpoints yet.',
          links: { home: null, docs: `${contextEngineUrl}/docs`, api: `${contextEngineUrl}/health` },
          connection: null,
          login: null,
          launchCommand: 'docker compose up -d context-engine',
        },
        {
          id: 'redis',
          name: 'Redis',
          type: 'cache',
          description: 'Optional legacy-profile service; not currently used by chat or project retrieval.',
          links: { home: null, docs: null, api: null },
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port || 6379),
            database: redisUrl.pathname.replace(/^\//, '') || '0',
            username: null,
            passwordEnvironmentVariable: redisUrl.password ? 'REDIS_URL' : null,
          },
          login: null,
          launchCommand: 'docker compose --profile legacy up -d redis',
        },
        {
          id: 'mlx-inference',
          name: 'MLX inference server',
          type: 'inference_api',
          description: 'Host-run local model server; model list endpoint reports the live provider response.',
          links: { home: null, docs: null, api: `${mlxUrl}/v1/models` },
          connection: null,
          login: null,
          launchCommand: 'HF_HUB_OFFLINE=1 mlx_lm.server --model mlx-community/Qwen3-8B-4bit',
        },
        {
          id: 'hermes-project-context',
          name: 'Hermes project-context MCP',
          type: 'stdio_mcp',
          description: 'Local Hermes integration. It uses stdio and has no browser URL or TCP port.',
          links: { home: null, docs: null, api: null },
          connection: null,
          login: null,
          launchCommand: 'python apps/context-engine/hermes_mcp.py',
        },
      ],
    };
  }
}
