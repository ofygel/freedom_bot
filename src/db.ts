import { Pool, PoolClient } from 'pg';

const useSSL = process.env.DB_SSL === 'true';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  options: '-c search_path=public,extensions',
  ...(useSSL ? { ssl: { rejectUnauthorized: false } } : {}),
});

export async function query<T = any>(sql: string, params: any[] = [], retries = 3): Promise<T[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await pool.query(sql, params);
      return res.rows as T[];
    } catch (err) {
      console.error('Database error', err);
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
  return [];
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Transaction error', e);
    throw e;
  } finally {
    client.release();
  }
}

export function close(): Promise<void>;
export function close(_signal: NodeJS.Signals): void;
export function close(_signal?: NodeJS.Signals): Promise<void> | void {
  if (typeof _signal === 'string') {
    void pool.end();
    return;
  }
  return pool.end();
}

process.once('SIGINT', close);
process.once('SIGTERM', close);

export default { query, transaction, close };
