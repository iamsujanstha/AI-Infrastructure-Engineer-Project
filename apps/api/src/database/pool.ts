import { Pool } from 'pg';

export interface PostgresConnectionConfig {
  DATABASE_URL: string;
  PG_POOL_MAX: number;
  PG_CONNECTION_TIMEOUT_MS: number;
}

export function createPostgresPool(environment: PostgresConnectionConfig): Pool {
  return new Pool({
    connectionString: environment.DATABASE_URL,
    max: environment.PG_POOL_MAX,
    connectionTimeoutMillis: environment.PG_CONNECTION_TIMEOUT_MS,
    application_name: 'local-ai-platform-api',
  });
}
