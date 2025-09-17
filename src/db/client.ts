import { Pool, PoolClient } from 'pg';
import type { PoolConfig } from 'pg';

import { config } from '../config';

const createSslOptions = (): PoolConfig['ssl'] => {
  if (!config.database.ssl) {
    return false;
  }

  return { rejectUnauthorized: true } satisfies NonNullable<PoolConfig['ssl']>;
};

const pool = new Pool({
  connectionString: config.database.url,
  ssl: createSslOptions(),
});

export { pool };           // Named export (import { pool } from ...)
export default pool;       // Default export (import pool from ...)

export type TransactionCallback<T> = (client: PoolClient) => Promise<T>;
export interface TransactionOptions {
  isolationLevel?: 'read committed' | 'repeatable read' | 'serializable';
}

export const withTx = async <T>(
  callback: TransactionCallback<T>,
  options: TransactionOptions = {},
): Promise<T> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    if (options.isolationLevel) {
      await client.query(
        `SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel.toUpperCase()}`
      );
    }

    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // eslint-disable-next-line no-console
      console.error('Failed to rollback transaction', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
};

export type { PoolClient } from 'pg';
