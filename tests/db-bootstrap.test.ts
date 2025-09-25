import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { ensureDatabaseSchema, resetDatabaseSchemaCache } from '../src/db/bootstrap';
import { pool } from '../src/db';

type QueryHandler = (text: string) => Promise<{ rows: unknown[] }>;

const originalConnect = pool.connect.bind(pool);

describe('database bootstrap', () => {
  beforeEach(() => {
    resetDatabaseSchemaCache();
  });

  afterEach(() => {
    (pool as unknown as { connect: typeof originalConnect }).connect = originalConnect;
  });

  it('skips schema application when sessions table is present', async () => {
    const queries: string[] = [];

    (pool as unknown as { connect: () => Promise<{ query: QueryHandler; release: () => void }> }).connect =
      async () => ({
        query: async (text) => {
          queries.push(text);
          if (text.includes('to_regclass')) {
            return { rows: [{ oid: 'sessions' }] };
          }

          throw new Error(`Unexpected SQL during bootstrap test: ${text}`);
        },
        release: () => {},
      });

    await ensureDatabaseSchema();

    assert.equal(queries.length, 1);
    assert.ok(
      queries[0]?.includes('to_regclass'),
      'bootstrap should only check the sessions table when it already exists',
    );
  });

  it('applies the schema snapshot when sessions table is missing', async () => {
    const queries: string[] = [];
    let snapshotExecuted = false;

    (pool as unknown as { connect: () => Promise<{ query: QueryHandler; release: () => void }> }).connect =
      async () => ({
        query: async (text) => {
          queries.push(text);

          if (text.includes('to_regclass')) {
            return { rows: [{ oid: null }] };
          }

          snapshotExecuted = true;
          assert.ok(
            text.includes('CREATE TABLE IF NOT EXISTS sessions'),
            'snapshot should create the sessions table',
          );
          return { rows: [] };
        },
        release: () => {},
      });

    await ensureDatabaseSchema();

    assert.equal(snapshotExecuted, true, 'bootstrap should execute the schema snapshot');
    assert.equal(queries.length, 2, 'bootstrap should perform a check and one snapshot execution');
  });
});
