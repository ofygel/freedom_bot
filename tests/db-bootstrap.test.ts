import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { ensureDatabaseSchema, resetDatabaseSchemaCache } from '../src/db/bootstrap';
import { pool } from '../src/db';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

const loadMigrationFiles = async (): Promise<string[]> => {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.up.sql'))
    .map((entry) => entry.name)
    .sort();
  return sqlFiles;
};

type QueryHandler = (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;

const originalConnect = pool.connect.bind(pool);

describe('database bootstrap', () => {
  beforeEach(() => {
    resetDatabaseSchemaCache();
  });

  afterEach(() => {
    (pool as unknown as { connect: typeof originalConnect }).connect = originalConnect;
  });

  it('skips migration execution when all migrations are recorded', async () => {
    const migrations = await loadMigrationFiles();
    const executed = new Set(migrations);
    let createTableCount = 0;
    let existenceChecks = 0;

    (pool as unknown as { connect: () => Promise<{ query: QueryHandler; release: () => void }> }).connect =
      async () => ({
        query: async (text, params) => {
          if (text.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
            createTableCount += 1;
            return { rows: [] };
          }

          if (text.startsWith('SELECT EXISTS')) {
            existenceChecks += 1;
            const [fileName] = params ?? [];
            return { rows: [{ exists: executed.has(fileName as string) }] };
          }

          if (text.includes('INSERT INTO schema_migrations')) {
            throw new Error('No migrations should be recorded when all are already applied');
          }

          throw new Error(`Unexpected SQL during bootstrap test: ${text}`);
        },
        release: () => {},
      });

    await ensureDatabaseSchema();

    assert.equal(createTableCount, 1, 'bootstrap should initialise the migrations table once');
    assert.equal(
      existenceChecks,
      migrations.length,
      'bootstrap should verify the status of every migration file',
    );
  });

  it('applies pending migrations when they are not recorded', async () => {
    const migrations = await loadMigrationFiles();
    const alreadyExecuted = new Set<string>();
    const applied: string[] = [];
    const recorded: string[] = [];
    let createTableCount = 0;
    const pendingQueue: string[] = [];

    (pool as unknown as { connect: () => Promise<{ query: QueryHandler; release: () => void }> }).connect =
      async () => ({
        query: async (text, params) => {
          if (text.startsWith('SELECT EXISTS')) {
            const [fileName] = params ?? [];
            const name = fileName as string;
            const exists = alreadyExecuted.has(name);
            if (!exists) {
              pendingQueue.push(name);
            }
            return { rows: [{ exists }] };
          }

          if (pendingQueue.length > 0) {
            const current = pendingQueue.shift()!;
            applied.push(current);
            return { rows: [] };
          }

          if (text.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
            createTableCount += 1;
            return { rows: [] };
          }

          if (text.includes('INSERT INTO schema_migrations')) {
            const [fileName] = params ?? [];
            recorded.push(fileName as string);
            return { rows: [] };
          }

          throw new Error(`Unexpected SQL during bootstrap test: ${text}`);
        },
        release: () => {},
      });

    await ensureDatabaseSchema();

    const expectedApplied = migrations.filter((name) => !alreadyExecuted.has(name));
    assert.deepEqual(applied, expectedApplied, 'bootstrap should apply every pending migration exactly once');
    assert.deepEqual(recorded, expectedApplied, 'bootstrap should record executed migrations');
    assert.equal(createTableCount, 1, 'bootstrap should initialise the migrations table once');
  });
});
