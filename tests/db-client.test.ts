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
      assert.equal(pool.options.ssl, false);
    } finally {
      await pool.end();
    }
  });

  it('enables TLS with certificate verification when DATABASE_SSL is true', async () => {
    process.env.DATABASE_SSL = 'true';

    const pool = await importPool();
    try {
      assert.equal(pool.options.connectionString, process.env.DATABASE_URL);
      assert.deepEqual(pool.options.ssl, { rejectUnauthorized: true });
    } finally {
      await pool.end();
    }
  });
});
