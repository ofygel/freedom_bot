import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

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

export default pool;
export type { PoolClient } from 'pg';
