import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { logger } from '../config';
import { pool } from './client';

const USERS_TABLE_EXISTS_SQL = `
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'users'
  ) AS exists
`;

const SCHEMA_FILE_PATH = path.resolve(__dirname, '../../db/schema_full.sql');

let schemaReady = false;
let bootstrapPromise: Promise<void> | null = null;
let cachedSchemaSql: string | null = null;

const loadSchemaSql = async (): Promise<string> => {
  if (!cachedSchemaSql) {
    cachedSchemaSql = await readFile(SCHEMA_FILE_PATH, 'utf-8');
  }
  return cachedSchemaSql;
};

const ensureSchema = async (): Promise<void> => {
  const client = await pool.connect();

  try {
    const { rows } = await client.query<{ exists: boolean }>(USERS_TABLE_EXISTS_SQL);
    const exists = rows[0]?.exists ?? false;

    if (exists) {
      schemaReady = true;
      return;
    }

    logger.info('Applying baseline database schema');
    const schemaSql = await loadSchemaSql();
    await client.query(schemaSql);
    schemaReady = true;
  } finally {
    client.release();
  }
};

export const ensureDatabaseSchema = async (): Promise<void> => {
  if (schemaReady) {
    return;
  }

  if (!bootstrapPromise) {
    bootstrapPromise = ensureSchema()
      .catch((error) => {
        logger.error({ err: error }, 'Failed to ensure database schema');
        throw error;
      })
      .finally(() => {
        bootstrapPromise = null;
      });
  }

  await bootstrapPromise;

  if (!schemaReady) {
    throw new Error('Database schema initialisation failed');
  }
};

/**
 * Testing helper used to reset the bootstrap state between test cases.
 * Not intended for production use.
 */
export const resetDatabaseSchemaCache = (): void => {
  schemaReady = false;
  bootstrapPromise = null;
  cachedSchemaSql = null;
};
