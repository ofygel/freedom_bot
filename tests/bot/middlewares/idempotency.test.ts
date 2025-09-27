import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import type { BotContext } from '../../../src/bot/types';

process.env.BOT_TOKEN ??= 'test-bot-token';
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/testdb';
process.env.KASPI_CARD ??= '1234';
process.env.KASPI_NAME ??= 'Test User';
process.env.KASPI_PHONE ??= '+77770000000';
process.env.WEBHOOK_DOMAIN ??= 'example.com';
process.env.WEBHOOK_SECRET ??= 'secret';

type IdempotencyModule = typeof import('../../../src/bot/middlewares/idempotency');
type DbModule = typeof import('../../../src/db');

let withIdempotency: IdempotencyModule['withIdempotency'];
let pool: DbModule['pool'];

before(async () => {
  ({ withIdempotency } = await import('../../../src/bot/middlewares/idempotency'));
  ({ pool } = await import('../../../src/db'));
});

describe('withIdempotency', () => {
  let poolQueryMock: ReturnType<typeof mock.method> | undefined;

  afterEach(() => {
    poolQueryMock?.mock.restore();
    poolQueryMock = undefined;
  });

  const createCtx = (userId = 12345): BotContext =>
    ({ from: { id: userId } } as unknown as BotContext);

  it('runs the handler exactly once when the key insert fails', async () => {
    let handlerCalls = 0;
    poolQueryMock = mock.method(pool, 'query', async (...args: unknown[]) => {
      const [sql] = args as [string];
      if (sql.includes('expires_at < now()')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error('insert failed');
    });

    const result = await withIdempotency(createCtx(), 'test-action', undefined, async () => {
      handlerCalls += 1;
      return 'handled';
    });

    assert.ok(poolQueryMock, 'pool.query should be mocked');
    assert.equal(poolQueryMock.mock.callCount(), 2);
    assert.equal(handlerCalls, 1);
    assert.deepEqual(result, { status: 'ok', result: 'handled' });
  });

  it('keeps throwing the original handler error even if cleanup fails', async () => {
    let handlerCalls = 0;
    let cleanupAttempts = 0;

    poolQueryMock = mock.method(pool, 'query', async (...args: unknown[]) => {
      const [sql] = args as [string];
      if (sql.includes('expires_at < now()')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO recent_actions')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('DELETE FROM recent_actions WHERE user_id = $1 AND key = $2')) {
        cleanupAttempts += 1;
        throw new Error('cleanup failed');
      }
      return { rowCount: 0, rows: [] };
    });

    const handlerError = new Error('handler blew up');

    await assert.rejects(
      () =>
        withIdempotency(createCtx(), 'test-action', undefined, async () => {
          handlerCalls += 1;
          throw handlerError;
        }),
      handlerError,
    );

    assert.ok(poolQueryMock, 'pool.query should be mocked');
    assert.equal(handlerCalls, 1);
    assert.equal(cleanupAttempts, 1);
  });
});
