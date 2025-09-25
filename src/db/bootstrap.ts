import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { logger } from '../config';
import { pool } from './client';

interface RegclassRow {
  oid: string | null;
}

const ALL_MIGRATIONS_PATH = path.resolve(__dirname, '../../db/sql/all_migrations.sql');
const CHECK_SESSIONS_SQL = "SELECT to_regclass('public.sessions') AS oid";

let schemaReady = false;
let bootstrapPromise: Promise<void> | null = null;
let cachedSchemaSql: string | null = null;

const loadSchemaSql = async (): Promise<string> => {
  if (cachedSchemaSql) {
    return cachedSchemaSql;
  }

  cachedSchemaSql = await readFile(ALL_MIGRATIONS_PATH, 'utf-8');
  return cachedSchemaSql;
};

const applySchemaSnapshot = async (): Promise<void> => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<RegclassRow>(CHECK_SESSIONS_SQL);
    if (rows[0]?.oid) {
      logger.debug('Database schema already contains sessions table, skipping bootstrap');
      schemaReady = true;
      return;
    }

    const schemaSql = await loadSchemaSql();
    logger.info('Database schema missing, applying all_migrations.sql snapshot');
    await client.query(schemaSql);
    schemaReady = true;
    logger.info('Database schema snapshot applied successfully');
  } finally {
    client.release();
  }
};

export const ensureDatabaseSchema = async (): Promise<void> => {
  if (schemaReady) {
    return;
  }

  if (!bootstrapPromise) {
    bootstrapPromise = applySchemaSnapshot().catch((error) => {
      logger.error({ err: error }, 'Failed to apply database schema snapshot');
      throw error;
    }).finally(() => {
      bootstrapPromise = null;
    });
  }

  await bootstrapPromise;

  if (!schemaReady) {
    throw new Error('Database schema bootstrap failed');
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
