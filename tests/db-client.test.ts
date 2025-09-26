import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const MODULE_PATHS = [
  '../src/db',
  '../src/db/client',
  '../src/config',
  '../src/config/env',
] as const;

const RESOLVED_MODULE_PATHS = MODULE_PATHS.map((modulePath) =>
  require.resolve(modulePath),
);

const clearModuleCache = (): void => {
  for (const path of RESOLVED_MODULE_PATHS) {
    delete require.cache[path];
  }
};

const importPool = async () => {
  clearModuleCache();
  const mod = await import('../src/db/client');
  return mod.pool;
};

describe('database client TLS configuration', () => {
  let databaseSslBackup: string | undefined;

  beforeEach(() => {
    databaseSslBackup = process.env.DATABASE_SSL;
  });

  afterEach(() => {
    if (databaseSslBackup === undefined) {
      delete process.env.DATABASE_SSL;
    } else {
      process.env.DATABASE_SSL = databaseSslBackup;
    }
    clearModuleCache();
  });

  it('disables TLS when DATABASE_SSL is not enabled', async () => {
    delete process.env.DATABASE_SSL;

    const pool = await importPool();
    try {
      assert.equal(pool.options.connectionString, process.env.DATABASE_URL);
      assert.equal(pool.options.ssl, undefined);
    } finally {
      await pool.end();
    }
  });

  it('enables TLS with certificate verification when DATABASE_SSL is true', async () => {
    process.env.DATABASE_SSL = 'true';

    const pool = await importPool();
    try {
      assert.equal(pool.options.connectionString, process.env.DATABASE_URL);
      assert.deepEqual(pool.options.ssl, { rejectUnauthorized: false });
    } finally {
      await pool.end();
    }
  });
});

describe('database client pool configuration', () => {
  const ENV_KEYS = [
    'DATABASE_POOL_MAX',
    'DATABASE_POOL_IDLE_TIMEOUT_MS',
    'DATABASE_POOL_CONNECTION_TIMEOUT_MS',
    'DATABASE_STATEMENT_TIMEOUT_MS',
    'DATABASE_QUERY_TIMEOUT_MS',
  ] as const;

  const envBackup: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = envBackup[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearModuleCache();
  });

  it('applies default pool tuning values', async () => {
    const pool = await importPool();
    try {
      assert.equal(pool.options.max, 10);
      assert.equal(pool.options.idleTimeoutMillis, 30_000);
      assert.equal(pool.options.connectionTimeoutMillis, 5_000);
      assert.equal(pool.options.statement_timeout, 15_000);
      assert.equal(pool.options.query_timeout, 20_000);
    } finally {
      await pool.end();
    }
  });

  it('honours pool tuning environment overrides', async () => {
    process.env.DATABASE_POOL_MAX = '15';
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = '45000';
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = '7000';
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = '12000';
    process.env.DATABASE_QUERY_TIMEOUT_MS = '18000';

    const pool = await importPool();
    try {
      assert.equal(pool.options.max, 15);
      assert.equal(pool.options.idleTimeoutMillis, 45_000);
      assert.equal(pool.options.connectionTimeoutMillis, 7_000);
      assert.equal(pool.options.statement_timeout, 12_000);
      assert.equal(pool.options.query_timeout, 18_000);
    } finally {
      await pool.end();
    }
  });
});
