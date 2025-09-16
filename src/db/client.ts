import { Pool, PoolClient, PoolConfig } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const parseBoolean = (value?: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 't', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'f', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
};

const defaultPort = Number.parseInt(process.env.DB_PORT ?? '5432', 10);

const baseConfig: PoolConfig = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number.isNaN(defaultPort) ? 5432 : defaultPort,
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASS ?? 'postgres',
  database: process.env.DB_NAME ?? 'freedom_bot',
};

const sslEnabled = parseBoolean(process.env.DB_SSL);
if (sslEnabled === true) {
  const rejectUnauthorized =
    parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED) ?? false;

  baseConfig.ssl = { rejectUnauthorized };
} else if (sslEnabled === false) {
  baseConfig.ssl = false;
}

export const pool = new Pool(baseConfig);

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
        `SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel.toUpperCase()}`,
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
