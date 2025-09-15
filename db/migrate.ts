import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

async function run() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    options: '-c search_path=public,extensions',
  });

  const client = await pool.connect();
  try {
    const migrationsDir = path.join(__dirname, 'migrations');
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id SERIAL PRIMARY KEY,
         name TEXT UNIQUE
       )`,
    );
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const { rowCount } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE name=$1',
        [file],
      );
      if (rowCount === 0) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
        console.log(`Applied ${file}`);
      } else {
        console.log(`Skipping ${file}`);
      }
    }

    const dataDir = path.join(process.cwd(), 'data');
    try {
      const users = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf-8'));
      for (const u of users) {
        await client.query(
          `INSERT INTO users (id, role, phone, city, consent)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             role = EXCLUDED.role,
             phone = EXCLUDED.phone,
             city = EXCLUDED.city,
             consent = EXCLUDED.consent`,
          [u.id, u.role, u.phone, u.city, u.consent],
        );
      }
      console.log(`Migrated ${users.length} users`);
    } catch (e) {
      console.log('No users.json found, skipping user migration');
    }

    try {
      const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf-8'));
      for (const [k, v] of Object.entries(settings)) {
        await client.query(
          `INSERT INTO app_settings (key, value)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [k, JSON.stringify(v)],
        );
      }
      console.log('Migrated settings');
    } catch (e) {
      console.log('No settings.json found, skipping settings migration');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

