import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { __testing, getChannelBinding, saveChannelBinding } from '../src/bot/channels/bindings';
import { pool } from '../src/db';

type QueryFunction = (
  ...args: Parameters<typeof pool.query>
) => ReturnType<typeof pool.query>;

const originalQuery: QueryFunction = pool.query.bind(pool);

const setPoolQuery = (fn: QueryFunction) => {
  (pool as unknown as { query: QueryFunction }).query = fn;
};

const extractQueryInvocation = (
  args: Parameters<typeof pool.query>,
): { text: string; params?: ReadonlyArray<unknown> } => {
  const [firstArg, secondArg] = args;

  if (typeof firstArg === 'string') {
    if (Array.isArray(secondArg)) {
      return { text: firstArg, params: secondArg };
    }

    if (secondArg && typeof secondArg === 'object') {
      const { values } = secondArg as { values?: ReadonlyArray<unknown> };
      if (values) {
        return { text: firstArg, params: values };
      }
    }

    return { text: firstArg };
  }

  if (firstArg && typeof firstArg === 'object' && 'text' in firstArg) {
    const config = firstArg as { text?: string; values?: ReadonlyArray<unknown> };
    return { text: config.text ?? '', params: config.values };
  }

  throw new Error(`Unexpected query invocation: ${JSON.stringify(firstArg)}`);
};

afterEach(() => {
  __testing.clearBindingCache();
  setPoolQuery(originalQuery);
});

describe('channel bindings', () => {
  it('persists stats channel binding', async () => {
    let executed: { text: string; params?: ReadonlyArray<unknown> } | undefined;
    const queryStub: QueryFunction = async (...args) => {
      executed = extractQueryInvocation(args);
      return { rows: [] } as any;
    };

    setPoolQuery(queryStub);

    await saveChannelBinding({ type: 'stats', chatId: -10012345 });

    assert.ok(executed, 'query should be executed');
    assert.ok(executed!.text.includes('stats_channel_id'));
    assert.equal(executed!.params?.[0], -10012345);
  });

  it('loads stats channel binding', async () => {
    let executedText: string | undefined;
    const queryStub: QueryFunction = async (...args) => {
      const { text } = extractQueryInvocation(args);
      executedText = text;
      return {
        rows: [
          {
            verify_channel_id: null,
            drivers_channel_id: null,
            stats_channel_id: '-10054321',
          },
        ],
      } as any;
    };

    setPoolQuery(queryStub);

    const binding = await getChannelBinding('stats');

    assert.ok(binding);
    assert.equal(binding?.type, 'stats');
    assert.equal(binding?.chatId, -10054321);
    assert.ok(executedText?.includes('stats_channel_id'));
  });

  it('returns cached stats binding when database query fails', async () => {
    let callCount = 0;
    const queryStub: QueryFunction = async () => {
      callCount += 1;

      if (callCount === 1) {
        return {
          rows: [
            {
              verify_channel_id: null,
              drivers_channel_id: null,
              stats_channel_id: '-10077777',
            },
          ],
        } as any;
      }

      throw new Error('database unavailable');
    };

    setPoolQuery(queryStub);

    const initial = await getChannelBinding('stats');
    assert.ok(initial);
    assert.equal(initial?.chatId, -10077777);

    const fallback = await getChannelBinding('stats');
    assert.ok(fallback);
    assert.equal(fallback?.chatId, -10077777);
    assert.equal(callCount, 2);
  });

  it('uses fallback drivers channel binding when env override is present', async () => {
    const previousEnv = process.env.DRIVERS_CHANNEL_ID;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const fallbackChatId = Number.parseInt(process.env.DRIVERS_CHANNEL_ID ?? '', 10);
    if (!Number.isFinite(fallbackChatId)) {
      throw new Error('Expected DRIVERS_CHANNEL_ID to be set for tests');
    }

    let selectCount = 0;
    let insertCount = 0;
    let insertedChatId: number | undefined;

    const queryStub: QueryFunction = async (...args) => {
      const { text, params } = extractQueryInvocation(args);

      if (/SELECT\s+verify_channel_id/i.test(text)) {
        selectCount += 1;

        if (typeof insertedChatId === 'number') {
          return {
            rows: [
              {
                verify_channel_id: null,
                drivers_channel_id: insertedChatId,
                stats_channel_id: null,
              },
            ],
          } as any;
        }

        return { rows: [] } as any;
      }

      if (/INSERT\s+INTO\s+channels/i.test(text)) {
        insertCount += 1;
        insertedChatId = params?.[0] as number;
        return { rows: [] } as any;
      }

      throw new Error(`Unexpected query invocation: ${text}`);
    };

    setPoolQuery(queryStub);

    try {
      const binding = await getChannelBinding('drivers');

      assert.ok(binding);
      assert.equal(binding?.chatId, fallbackChatId);
      assert.equal(insertCount, 1);
      assert.equal(insertedChatId, fallbackChatId);

      const cached = await getChannelBinding('drivers');
      assert.ok(cached);
      assert.equal(cached.chatId, fallbackChatId);
      assert.equal(selectCount, 1);
    } finally {
      if (previousEnv === undefined) {
        delete process.env.DRIVERS_CHANNEL_ID;
      } else {
        process.env.DRIVERS_CHANNEL_ID = previousEnv;
      }

      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      insertedChatId = undefined;
    }
  });

  it('returns fallback drivers binding when database query fails', async () => {
    const fallbackChatId = Number.parseInt(process.env.DRIVERS_CHANNEL_ID ?? '', 10);
    if (!Number.isFinite(fallbackChatId)) {
      throw new Error('Expected DRIVERS_CHANNEL_ID to be set for tests');
    }

    let selectCount = 0;
    let insertCount = 0;

    const queryStub: QueryFunction = async (...args) => {
      const { text } = extractQueryInvocation(args);

      if (/SELECT\s+verify_channel_id/i.test(text)) {
        selectCount += 1;
        throw new Error('database unavailable');
      }

      if (/INSERT\s+INTO\s+channels/i.test(text)) {
        insertCount += 1;
        throw new Error('database unavailable');
      }

      return { rows: [] } as any;
    };

    setPoolQuery(queryStub);

    const binding = await getChannelBinding('drivers');

    assert.ok(binding);
    assert.equal(binding?.chatId, fallbackChatId);
    assert.equal(selectCount, 1);
    assert.equal(insertCount, 1);
  });
});
