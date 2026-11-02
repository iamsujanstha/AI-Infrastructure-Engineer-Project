import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url().default('postgresql://platform:platform_dev_only@127.0.0.1:5432/local_ai_platform'),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  PG_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(2000),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).max(10000).default(120),
  INFERENCE_HEALTH_URL: z.union([z.string().url(), z.literal('')]).default(''),
  INFERENCE_HEALTH_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(2000),
}).superRefine((value, context) => {
  if (!['postgres:', 'postgresql:'].includes(new URL(value.DATABASE_URL).protocol)) {
    context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'must use postgres:// or postgresql://' });
  }
  if (!['redis:', 'rediss:'].includes(new URL(value.REDIS_URL).protocol)) {
    context.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'must use redis:// or rediss://' });
  }
  const origins = value.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
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
