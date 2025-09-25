import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PoolClient } from 'pg';

import { logger } from '../config';
import { pool } from './client';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/sql');
const SNAPSHOT_FILE = 'all_migrations.sql';
const MIGRATIONS_TABLE = 'schema_migrations';

export type MigrationAction = 'apply' | 'skip';

export interface MigrationEvent {
  name: string;
  action: MigrationAction;
}

export type MigrationLogger = (event: MigrationEvent) => void;

const defaultLogger: MigrationLogger = ({ name, action }) => {
  if (action === 'skip') {
    logger.debug({ migration: name }, 'Skipping already applied migration');
  } else {
    logger.info({ migration: name }, 'Applying migration');
  }
};

export const listMigrationFiles = async (): Promise<string[]> => {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql') && entry.name !== SNAPSHOT_FILE)
    .map((entry) => entry.name)
    .sort();
};

const ensureMigrationsTable = async (client: PoolClient): Promise<void> => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id bigserial PRIMARY KEY,
      name text UNIQUE NOT NULL,
      executed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
};

const hasMigrationRun = async (client: PoolClient, fileName: string): Promise<boolean> => {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE name = $1) AS exists`,
    [fileName],
  );

  return rows[0]?.exists ?? false;
};

const markMigrationExecuted = async (client: PoolClient, fileName: string): Promise<void> => {
  await client.query(
    `
      INSERT INTO ${MIGRATIONS_TABLE} (name)
      VALUES ($1)
      ON CONFLICT (name) DO UPDATE SET executed_at = now()
    `,
    [fileName],
  );
};

export const applyPendingMigrations = async (
  client: PoolClient,
  log: MigrationLogger = defaultLogger,
): Promise<number> => {
  const files = await listMigrationFiles();
  if (files.length === 0) {
    return 0;
  }

  await ensureMigrationsTable(client);

  let applied = 0;

  for (const file of files) {
    if (await hasMigrationRun(client, file)) {
      log({ name: file, action: 'skip' });
      continue;
    }

    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const trimmed = sql.trim();

    if (!trimmed) {
      log({ name: file, action: 'skip' });
      await markMigrationExecuted(client, file);
      continue;
    }

    log({ name: file, action: 'apply' });
    await client.query(trimmed);
    await markMigrationExecuted(client, file);
    applied += 1;
  }

  return applied;
};

export const runPendingMigrations = async (log: MigrationLogger = defaultLogger): Promise<number> => {
  const client = await pool.connect();
  try {
    return await applyPendingMigrations(client, log);
  } finally {
    client.release();
  }
};
