import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { getChannelBinding, saveChannelBinding } from '../src/bot/channels/bindings';
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
});
