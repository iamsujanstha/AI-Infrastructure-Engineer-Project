import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool, QueryResultRow } from 'pg';

export interface MigrationFile {
  name: string;
  checksum: string;
  sql: string;
}

export interface AppliedMigration extends QueryResultRow {
  migration_name: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export class MigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MigrationError';
  }
}

export async function readMigrationFiles(directory: string): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
  const seenVersions = new Set<string>();
  const migrations: MigrationFile[] = [];

  for (const name of names) {
    const match = /^(\d{4,})_[a-z0-9_]+\.sql$/.exec(name);
    if (!match) throw new MigrationError(`Invalid migration filename: ${name}`);
    const version = match[1];
    if (!version || seenVersions.has(version)) {
      throw new MigrationError(`Duplicate migration version: ${version ?? name}`);
    }
    seenVersions.add(version);

    const sql = await readFile(resolve(directory, name), 'utf8');
    if (sql.trim().length === 0) throw new MigrationError(`Migration is empty: ${name}`);
    const checksum = createHash('sha256').update(sql, 'utf8').digest('hex');
    migrations.push({ name, checksum, sql });
  }

  return migrations;
}

export function validateMigrationHistory(
  available: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): void {
  const byName = new Map(available.map((migration) => [migration.name, migration]));
  for (const record of applied) {
    const migration = byName.get(record.migration_name);
    if (!migration) {
      throw new MigrationError(`Applied migration is missing from this release: ${record.migration_name}`);
    }
    if (migration.checksum !== record.checksum) {
      throw new MigrationError(`Applied migration has changed: ${record.migration_name}`);
    }
  }
}

const MIGRATION_LOCK_NAMESPACE = 1279608912;
const MIGRATION_LOCK_ID = 1;

export async function runMigrations(pool: Pool, directory: string): Promise<MigrationResult> {
  const migrations = await readMigrationFiles(directory);
  const client = await pool.connect();
  let lockAcquired = false;
  let clientReleased = false;

  try {
    const lock = await client.query<QueryResultRow & { locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_ID],
    );
    lockAcquired = lock.rows[0]?.locked === true;
    if (!lockAcquired) {
      throw new MigrationError('Another migration runner already holds the database migration lock');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS _platform_schema_migrations (
        migration_name text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);

    const history = await client.query<AppliedMigration>(
      'SELECT migration_name, checksum FROM _platform_schema_migrations ORDER BY migration_name',
    );
    validateMigrationHistory(migrations, history.rows);
    const appliedNames = new Set(history.rows.map((record) => record.migration_name));
    const applied: string[] = [];
    const alreadyApplied: string[] = [];

    for (const migration of migrations) {
      if (appliedNames.has(migration.name)) {
        alreadyApplied.push(migration.name);
        continue;
      }

      await client.query('BEGIN');
      try {
        // One migration per transaction makes partial schema application visible and recoverable.
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO _platform_schema_migrations (migration_name, checksum) VALUES ($1, $2)',
          [migration.name, migration.checksum],
        );
        await client.query('COMMIT');
        applied.push(migration.name);
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          client.release(error instanceof Error ? error : new Error('Migration rollback failed'));
          clientReleased = true;
          throw new MigrationError(`Rollback failed for migration ${migration.name}`, { cause: error });
        }
        throw new MigrationError(`Migration failed: ${migration.name}`, { cause: error });
      }
    }

    return { applied, alreadyApplied };
  } finally {
    if (!clientReleased && lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_ID]);
      } finally {
        client.release();
      }
    } else if (!clientReleased) {
      client.release();
    }
  }
}
