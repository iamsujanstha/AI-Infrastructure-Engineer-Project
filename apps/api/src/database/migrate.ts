import 'reflect-metadata';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import pino from 'pino';
import { parseEnvironment } from '../config/environment';
import { createPostgresPool } from './pool';
import { runMigrations } from './migration-runner';

async function main(): Promise<void> {
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let logger = pino();

  try {
    dotenv.config({ path: resolve(process.cwd(), '.env'), override: false });
    dotenv.config({ path: resolve(process.cwd(), '../../.env'), override: false });
    const environment = parseEnvironment(process.env);
    logger = pino({ level: environment.LOG_LEVEL });
    pool = createPostgresPool(environment);
    const result = await runMigrations(pool, resolve(__dirname, '../../migrations'));
    logger.info(result, 'Database migrations complete');
  } catch (error) {
    logger.fatal({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Database migration failed');
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

void main();
