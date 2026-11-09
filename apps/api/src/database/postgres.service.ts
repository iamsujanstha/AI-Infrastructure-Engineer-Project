import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { AppEnvironment } from '../config/environment';
import { createPostgresPool } from './pool';
import { deadlineQuery } from './query-deadline';

@Injectable()
export class PostgresService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly logger = new Logger(PostgresService.name);

  constructor(@Inject(ConfigService) config: ConfigService<AppEnvironment, true>) {
    this.pool = createPostgresPool({
      DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
      PG_POOL_MAX: config.get('PG_POOL_MAX', { infer: true }),
      PG_CONNECTION_TIMEOUT_MS: config.get('PG_CONNECTION_TIMEOUT_MS', { infer: true }),
    });
    this.pool.on('error', (error: Error) => {
      // Idle client failures have no request context, so avoid logging connection details.
      this.logger.error(`Unexpected idle database client error: ${error.name}`);
    });
  }

  async checkConnection(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
    timeoutMs?: number,
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(deadlineQuery(text, values, timeoutMs));
  }

  async withTransaction<T>(work: (client: PoolClient) => Promise<T>, timeoutMs?: number): Promise<T> {
    const client = await this.pool.connect();
    let clientReleased = false;
    try {
      await client.query(deadlineQuery('BEGIN', undefined, timeoutMs));
      const result = await work(client);
      await client.query(deadlineQuery('COMMIT', undefined, timeoutMs));
      return result;
    } catch (error) {
      try {
        await client.query(deadlineQuery('ROLLBACK', undefined, timeoutMs));
      } catch {
        client.release(error instanceof Error ? error : new Error('Transaction rollback failed'));
        clientReleased = true;
      }
      throw error;
    } finally {
      if (!clientReleased) client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
