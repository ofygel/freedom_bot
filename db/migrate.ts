import fs from 'fs/promises';
import path from 'path';
import type { PoolClient } from 'pg';

import { pool, withTx } from '../src/db/client';

const MIGRATIONS_DIR = path.resolve(__dirname, 'sql');
const MIGRATIONS_TABLE = 'schema_migrations';

const readMigrationFiles = async (): Promise<string[]> => {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
};

const ensureMigrationsTable = async (client: PoolClient) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id bigserial PRIMARY KEY,
      name text UNIQUE NOT NULL,
      executed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
};

const applyMigration = async (
  client: PoolClient,
  fileName: string,
  sql: string,
): Promise<void> => {
  const trimmed = sql.trim();
  if (!trimmed) {
    console.log(`Skipping empty migration ${fileName}`);
    return;
  }

  console.log(`Applying migration ${fileName}...`);
  await client.query(trimmed);
  await client.query(
    `
      INSERT INTO ${MIGRATIONS_TABLE} (name)
      VALUES ($1)
      ON CONFLICT (name) DO UPDATE SET executed_at = now()
    `,
    [fileName],
  );
};

const runMigrations = async (): Promise<void> => {
  const files = await readMigrationFiles();

  await withTx(async (client) => {
    await ensureMigrationsTable(client);
    for (const file of files) {
      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sql = await fs.readFile(fullPath, 'utf-8');
      await applyMigration(client, file, sql);
    }
  });
};

const main = async () => {
  try {
    await runMigrations();
    console.log('Migrations complete.');
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
