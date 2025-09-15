import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
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

export async function transaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
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

export default { query, transaction };
