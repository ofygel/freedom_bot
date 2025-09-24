import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { Telegraf } from 'telegraf';
import type { Telegram } from 'telegraf';

import {
  createModerationQueue,
  type ModerationQueueItemBase,
} from '../src/bot/moderation/queue';
import type { BotContext } from '../src/bot/types';
import { pool } from '../src/db';

interface CallbackRecord {
  token: string;
  action: string;
  chatId: number | null;
  messageId: number | null;
  payload: any;
  expiresAt: Date;
}

const callbackMap = new Map<string, CallbackRecord>();

const channelsRow = {
  verify_channel_id: '555',
  drivers_channel_id: null,
  stats_channel_id: '-100777888',
};

const originalQuery = pool.query.bind(pool);

const setPoolQuery = (fn: typeof pool.query) => {
  (pool as unknown as { query: typeof pool.query }).query = fn;
};

const fakeQuery = (async (...args: any[]) => {
  let text: string;
  let params: any[];

  if (typeof args[0] === 'string') {
    text = args[0];
    params = (args[1] ?? []) as any[];
  } else if (args[0] && typeof args[0] === 'object' && 'text' in args[0]) {
    text = (args[0] as { text: string }).text;
    params = (args[1] ?? []) as any[];
  } else {
    throw new Error(`Unexpected query invocation: ${JSON.stringify(args[0])}`);
  }

  if (/SELECT\s+verify_channel_id/i.test(text)) {
    return { rows: [channelsRow] } as any;
  }

  if (/INSERT\s+INTO\s+callback_map/i.test(text)) {
    const [token, action, chatId, messageId, payload, expiresAt] = params;
    callbackMap.set(token, {
      token,
      action,
      chatId: chatId ?? null,
      messageId: messageId ?? null,
      payload,
      expiresAt,
    });
    return { rows: [] } as any;
  }

  if (/SELECT\s+token,\s+action,\s+chat_id,\s+message_id,\s+payload,\s+expires_at\s+FROM\s+callback_map\s+WHERE\s+token\s*=\s*\$1/i.test(text)) {
    const [token] = params;
    const record = callbackMap.get(token);
    if (!record) {
      return { rows: [] } as any;
    }

    return {
      rows: [
        {
          token: record.token,
          action: record.action,
          chat_id: record.chatId,
          message_id: record.messageId,
          payload: record.payload,
          expires_at: record.expiresAt,
        },
      ],
    } as any;
  }

  if (/SELECT\s+token,\s+action,\s+chat_id,\s+message_id,\s+payload,\s+expires_at\s+FROM\s+callback_map\s+WHERE\s+action\s*=\s*\$1/i.test(text)) {
    const [action] = params;
    const rows = Array.from(callbackMap.values())
      .filter((record) => record.action === action && record.expiresAt.getTime() > Date.now())
      .map((record) => ({
        token: record.token,
        action: record.action,
        chat_id: record.chatId,
        message_id: record.messageId,
        payload: record.payload,
        expires_at: record.expiresAt,
      }));
    return { rows } as any;
  }

  if (/DELETE\s+FROM\s+callback_map/i.test(text)) {
    const [token] = params;
    callbackMap.delete(token);
    return { rows: [] } as any;
  }

  throw new Error(`Unexpected query: ${text}`);
}) as typeof pool.query;

interface TestItem extends ModerationQueueItemBase<TestItem> {
  id: string;
  label: string;
}

describe('moderation queue persistence', () => {
  beforeEach(() => {
    callbackMap.clear();
    setPoolQuery(fakeQuery);
  });

  const restorePool = () => {
    setPoolQuery(originalQuery);
  };

  afterEach(() => {
    restorePool();
  });

  it('restores pending approvals after restart', async () => {
    const approvals: string[] = [];

    const deserializeItem = (payload: unknown): TestItem | null => {
      if (!payload || typeof payload !== 'object') {
        return null;
      }

      const item = payload as TestItem;
      item.onApprove = async (context) => {
        approvals.push(context.item.id);
      };
      return item;
    };

    const queue = createModerationQueue<TestItem>({
      type: 'test',
      channelType: 'verify',
      defaultRejectionReasons: ['Нет данных'],
      renderMessage: (item) => item.label,
      deserializeItem,
    });

    const telegram = {
      async sendMessage() {
        return { message_id: 101, chat: { id: 555 } };
      },
      async editMessageText() {
        return true;
      },
    } as unknown as Telegram;

    const publishResult = await queue.publish(telegram, {
      id: 'item-1',
      label: 'Test item',
    });

    assert.equal(publishResult.status, 'published');
    const token = publishResult.token;
    assert.ok(token);
    assert.equal(callbackMap.has(token!), true);

    const queueAfterRestart = createModerationQueue<TestItem>({
      type: 'test',
      channelType: 'verify',
      defaultRejectionReasons: ['Нет данных'],
      renderMessage: (item) => item.label,
      deserializeItem,
    });

    await queueAfterRestart.restore();

    let approveHandler: ((ctx: BotContext) => Promise<void>) | undefined;

    const bot = {
      action(pattern: RegExp, handler: (ctx: BotContext) => Promise<void>) {
        if (pattern.test(`mod:test:accept:${token}`)) {
          approveHandler = handler;
        }
      },
      on() {},
    } as unknown as Telegraf<BotContext>;

    queueAfterRestart.register(bot);
    assert.ok(approveHandler, 'Approve handler should be registered');

    const ctx = {
      match: [`mod:test:accept:${token}`, token],
      telegram,
      from: { id: 42 },
      chat: { id: 555 },
      answerCbQuery: async () => {},
    } as unknown as BotContext;

    await approveHandler!(ctx);

    assert.deepEqual(approvals, ['item-1']);
    assert.equal(callbackMap.size, 0);

  });
});
