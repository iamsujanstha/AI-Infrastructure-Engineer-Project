import { z } from 'zod';
import { isIP } from 'node:net';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  LOCAL_CHAT_CONTAINER_MODE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  LEGACY_LOCAL_CHAT_ENABLED: z.enum(['true','false']).default('false').transform((value)=>value==='true'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url().default('postgresql://platform:platform_dev_only@127.0.0.1:5432/local_ai_platform'),
  PGADMIN_PORT: z.coerce.number().int().min(1).max(65535).default(5050),
  PGADMIN_DEFAULT_EMAIL: z.string().email().default('admin@localhost.com'),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  PG_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(2000),
  PEOPLE_DB_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
  POLICY_COMPUTE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(60000),
  POLICY_SMALL_MODEL: z.string().max(250).default(''),
  POLICY_LARGE_MODEL: z.string().max(250).default(''),
  POLICY_SEMANTIC_CACHE_ENABLED: z.enum(['true','false']).default('false').transform((v) => v === 'true'),
  OIDC_ISSUER: z.union([z.string().url(),z.literal('')]).default(''),
  OIDC_CLIENT_ID: z.string().max(500).default(''),
  OIDC_CLIENT_SECRET: z.string().max(4000).default(''),
  OIDC_REDIRECT_URI: z.string().url().default('http://127.0.0.1:4000/api/v1/cms/oidc/callback'),
  OIDC_WEB_ORIGIN: z.string().url().default('http://127.0.0.1:3000'),
  OIDC_GOOGLE_WORKSPACE_DOMAIN: z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)?$/).default(''),
  OIDC_ALLOWED_HOSTS: z.string().max(2000).default(''),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).max(10000).default(120),
  INFERENCE_HEALTH_URL: z.union([z.string().url(), z.literal('')]).default(''),
  INFERENCE_HEALTH_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(2000),
  CONTEXT_ENGINE_URL: z.string().url().default('http://127.0.0.1:8000'),
  CONTEXT_ENGINE_PUBLIC_URL: z.string().url().default('http://127.0.0.1:8000'),
  CONTEXT_ENGINE_TOKEN: z.string().min(32).default('context-engine-local-dev-token-change-before-use-32'),
  CONTEXT_ENGINE_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(1500),
  MLX_BASE_URL: z.string().url().default('http://127.0.0.1:8080'),
  MLX_ALLOW_HOST_GATEWAY: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  MLX_DEFAULT_MODEL: z.string().min(1).max(250).default('mlx-community/Qwen3-8B-4bit'),
  MLX_QWEN3_ENABLE_THINKING: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  MLX_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(180000),
  MLX_CONTEXT_WINDOW_TOKENS: z.coerce.number().int().min(1024).max(1000000).default(8192),
  MLX_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(4096).default(512),
}).superRefine((value, context) => {
  if (value.OIDC_ISSUER) {
    const issuer = new URL(value.OIDC_ISSUER); const callback = new URL(value.OIDC_REDIRECT_URI); const web = new URL(value.OIDC_WEB_ORIGIN);
    if(value.OIDC_ISSUER==='https://accounts.google.com' && !value.OIDC_GOOGLE_WORKSPACE_DOMAIN)context.addIssue({code:'custom',path:['OIDC_GOOGLE_WORKSPACE_DOMAIN'],message:'Google Workspace requires the verified hosted-domain restriction'});
    if (issuer.protocol!=='https:' || issuer.username || issuer.password || issuer.search || issuer.hash || !value.OIDC_CLIENT_ID) {
      context.addIssue({ code: 'custom',path:['OIDC_ISSUER'],message:'requires a pinned HTTPS issuer and client ID, without credentials/query/fragment' });
    }
    if (!['127.0.0.1','localhost','[::1]'].includes(callback.hostname) || callback.pathname!=='/api/v1/cms/oidc/callback'
        || callback.search || callback.hash || callback.username || callback.password || !['http:','https:'].includes(callback.protocol)
        || web.origin!==value.OIDC_WEB_ORIGIN || web.hostname!==callback.hostname
        || !value.CORS_ORIGINS.split(',').map((o)=>o.trim()).includes(web.origin)) {
      context.addIssue({code:'custom',path:['OIDC_REDIRECT_URI'],message:'requires the exact loopback callback and a same-host configured web origin'});
    }
    if (value.OIDC_ALLOWED_HOSTS.split(',').filter(Boolean).some((host)=>! /^[a-z0-9.-]+$/i.test(host.trim()))) {
      context.addIssue({code:'custom',path:['OIDC_ALLOWED_HOSTS'],message:'must be an explicit comma-separated HTTPS hostname allowlist'});
    }
  }
  if (!['postgres:', 'postgresql:'].includes(new URL(value.DATABASE_URL).protocol)) {
    context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'must use postgres:// or postgresql://' });
  }
  if (!['redis:', 'rediss:'].includes(new URL(value.REDIS_URL).protocol)) {
    context.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'must use redis:// or rediss://' });
  }
  const origins = value.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  const mlxUrl = new URL(value.MLX_BASE_URL);
  const mlxHost = mlxUrl.hostname.replace(/^\[|\]$/g, '');
  const mlxLoopback = mlxHost === 'localhost' || (isIP(mlxHost) > 0 && isIP(mlxHost) === 4 && mlxHost.startsWith('127.'))
    || (isIP(mlxHost) === 6 && mlxHost === '::1');
  const mlxHostGateway = value.MLX_ALLOW_HOST_GATEWAY && value.NODE_ENV !== 'production'
    && mlxHost === 'host.docker.internal';
  if (mlxUrl.protocol !== 'http:' || (!mlxLoopback && !mlxHostGateway) || mlxUrl.username || mlxUrl.password
      || mlxUrl.search || mlxUrl.hash || !['', '/'].includes(mlxUrl.pathname)) {
    context.addIssue({ code: 'custom', path: ['MLX_BASE_URL'], message: 'must be an HTTP loopback URL, or host.docker.internal with MLX_ALLOW_HOST_GATEWAY enabled in development, with no credentials or extra path' });
  }
  if (value.MLX_ALLOW_HOST_GATEWAY && (value.NODE_ENV === 'production' || mlxHost !== 'host.docker.internal')) {
    context.addIssue({ code: 'custom', path: ['MLX_ALLOW_HOST_GATEWAY'], message: 'is only valid in development when MLX_BASE_URL uses host.docker.internal' });
  }
  if (value.LOCAL_CHAT_CONTAINER_MODE && (value.NODE_ENV === 'production' || value.API_HOST !== '0.0.0.0')) {
    context.addIssue({ code: 'custom', path: ['LOCAL_CHAT_CONTAINER_MODE'], message: 'is only valid in development when API_HOST is 0.0.0.0' });
  }
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
        throw new Error('origin must be an http(s) origin without a path');
      }
    } catch {
      context.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: `contains an invalid origin: ${origin}` });
    }
  }
  if (value.NODE_ENV === 'production') {
    if (value.DATABASE_URL.includes('platform_dev_only')) {
      context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'development credentials are forbidden in production' });
    }
    if (value.CONTEXT_ENGINE_TOKEN.includes('local-dev-token')) {
      context.addIssue({ code: 'custom', path: ['CONTEXT_ENGINE_TOKEN'], message: 'development service token is forbidden in production' });
    }
    if (new URL(value.REDIS_URL).password === '' && new URL(value.REDIS_URL).protocol !== 'rediss:') {
      context.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'production Redis must use a password or TLS' });
    }
    if (origins.length === 0) {
      context.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'at least one browser origin is required in production' });
    }
    if (origins.some((origin) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(origin).hostname))) {
      context.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'localhost origins are forbidden in production' });
    }
  }
});

export type AppEnvironment = Omit<z.infer<typeof environmentSchema>, 'CORS_ORIGINS'> & {
  CORS_ORIGINS: string[];
};

export function parseEnvironment(source: Record<string, unknown>): AppEnvironment {
  const parsed = environmentSchema.parse(source);
  return {
    ...parsed,
    CORS_ORIGINS: parsed.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  };
}
