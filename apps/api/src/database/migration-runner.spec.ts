import { describe, expect, it } from 'vitest';
import { MigrationError, validateMigrationHistory } from './migration-runner';
import type { MigrationFile } from './migration-runner';

const migration: MigrationFile = {
  name: '0001_enable_pgvector.sql',
  checksum: 'sha256-checksum',
  sql: 'CREATE EXTENSION IF NOT EXISTS vector;',
};

describe('validateMigrationHistory', () => {
  it('accepts an applied migration when its file and checksum are unchanged', () => {
    expect(() => validateMigrationHistory([migration], [
      { migration_name: migration.name, checksum: migration.checksum },
    ])).not.toThrow();
  });

  it('rejects edits to an already-applied migration', () => {
    expect(() => validateMigrationHistory([migration], [
      { migration_name: migration.name, checksum: 'different-checksum' },
    ])).toThrow(MigrationError);
  });

  it('rejects an applied migration whose file was removed', () => {
    expect(() => validateMigrationHistory([], [
      { migration_name: migration.name, checksum: migration.checksum },
    ])).toThrow(/missing from this release/);
  });
});
