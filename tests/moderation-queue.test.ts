import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

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

const MANUAL_REVIEW_MESSAGE = 'Не удалось обработать заявку. Требуется ручная проверка.';

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

  it('stops approval when the decision callback fails', async () => {
    const queue = createModerationQueue<TestItem>({
      type: 'test',
      channelType: 'verify',
      defaultRejectionReasons: ['Нет данных'],
      renderMessage: (item) => item.label,
    });

    const sendMessageMock = mock.fn<
      (chatId: number, text: string, extra?: unknown) => Promise<{ message_id: number; chat: { id: number; type: string } }>
    >(async () => ({ message_id: 201, chat: { id: 555, type: 'supergroup' } }));
    const editMessageTextMock = mock.fn<
      (chatId: number, messageId: number, inlineMessageId: undefined, text: string, extra?: unknown) => Promise<void>
    >(async () => {});

    const telegram = {
      sendMessage: sendMessageMock as unknown as Telegram['sendMessage'],
      editMessageText: editMessageTextMock as unknown as Telegram['editMessageText'],
    } as Telegram;

    const publishResult = await queue.publish(telegram, {
      id: 'item-approval-failure',
      label: 'Approval failure',
      async onApprove() {
        throw new Error('db lookup failed');
      },
    });

    assert.equal(publishResult.status, 'published');
    const token = publishResult.token;
    assert.ok(token);

    let approveHandler: ((ctx: BotContext) => Promise<void>) | undefined;
    const bot = {
      action(pattern: RegExp, handler: (ctx: BotContext) => Promise<void>) {
        if (token && pattern.test(`mod:test:accept:${token}`)) {
          approveHandler = handler;
        }
      },
      on() {},
    } as unknown as Telegraf<BotContext>;

    queue.register(bot);
    assert.ok(approveHandler, 'Approve handler should be registered');

    const answerCbQueryMock = mock.fn<(text?: string) => Promise<void>>(async () => {});
    const ctx = {
      match: [`mod:test:accept:${token}`, token],
      telegram,
      from: { id: 42 },
      chat: { id: 555, type: 'supergroup' },
      answerCbQuery: answerCbQueryMock as unknown as BotContext['answerCbQuery'],
    } as unknown as BotContext;

    await approveHandler!(ctx);

    assert.equal(answerCbQueryMock.mock.callCount(), 1);
    const [answerCall] = answerCbQueryMock.mock.calls;
    assert.ok(answerCall);
    const [response] = answerCall.arguments;
    assert.equal(response, MANUAL_REVIEW_MESSAGE);

    assert.equal(editMessageTextMock.mock.callCount(), 0);
    assert.ok(token);
    const stored = callbackMap.get(token!);
    assert.ok(stored);
    assert.equal(stored?.payload?.failed, true);
    assert.equal(stored?.payload?.status, 'pending');
  });

  it('stops rejection when the decision callback fails', async () => {
    const queue = createModerationQueue<TestItem>({
      type: 'test',
      channelType: 'verify',
      defaultRejectionReasons: ['Нет данных'],
      renderMessage: (item) => item.label,
    });

    const sendMessageMock = mock.fn<
      (chatId: number, text: string, extra?: unknown) => Promise<{ message_id: number; chat: { id: number; type: string } }>
    >(async () => ({ message_id: 301, chat: { id: 555, type: 'supergroup' } }));
    const editMessageTextMock = mock.fn<
      (chatId: number, messageId: number, inlineMessageId: undefined, text: string, extra?: unknown) => Promise<void>
    >(async () => {});

    const telegram = {
      sendMessage: sendMessageMock as unknown as Telegram['sendMessage'],
      editMessageText: editMessageTextMock as unknown as Telegram['editMessageText'],
    } as Telegram;

    const publishResult = await queue.publish(telegram, {
      id: 'item-rejection-failure',
      label: 'Rejection failure',
      rejectionReasons: ['Нет данных'],
      async onReject() {
        throw new Error('db lookup failed');
      },
    });

    assert.equal(publishResult.status, 'published');
    const token = publishResult.token;
    assert.ok(token);

    let rejectHandler: ((ctx: BotContext) => Promise<void>) | undefined;
    let textHandler: ((ctx: BotContext, next?: () => Promise<void>) => Promise<void>) | undefined;

    const bot = {
      action(pattern: RegExp, handler: (ctx: BotContext) => Promise<void>) {
        const source = pattern.toString();
        if (source.includes(':reject')) {
          rejectHandler = handler;
        }
      },
      on(event: string, handler: (ctx: BotContext, next?: () => Promise<void>) => Promise<void>) {
        if (event === 'text') {
          textHandler = handler;
        }
      },
    } as unknown as Telegraf<BotContext>;

    queue.register(bot);
    assert.ok(rejectHandler, 'Reject handler should be registered');
    assert.ok(textHandler, 'Text handler should be registered');

    const answerCbQueryMock = mock.fn<(text?: string) => Promise<void>>(async () => {});
    const promptReplyMock = mock.fn<
      (text: string, extra?: { reply_markup?: unknown }) => Promise<{ message_id: number; chat: { id: number } }>
    >(async () => ({ message_id: 777, chat: { id: 555 } }));

    const rejectCtx = {
      match: [`mod:test:reject:${token}:0`, token, '0'],
      telegram,
      from: { id: 42 },
      chat: { id: 555, type: 'supergroup' },
      answerCbQuery: answerCbQueryMock as unknown as BotContext['answerCbQuery'],
      reply: promptReplyMock as unknown as BotContext['reply'],
    } as unknown as BotContext;

    await rejectHandler!(rejectCtx);

    assert.equal(promptReplyMock.mock.callCount(), 1);

    const responseReplyMock = mock.fn<
      (text: string, extra?: { reply_parameters?: { message_id: number } }) => Promise<unknown>
    >(async () => ({}));

    const textCtx = {
      message: {
        text: 'Причина',
        message_id: 900,
        reply_to_message: { message_id: 777 },
      },
      chat: { id: 555, type: 'supergroup' },
      telegram,
      from: { id: 42 },
      reply: responseReplyMock as unknown as BotContext['reply'],
    } as unknown as BotContext;

    await textHandler!(textCtx);

    assert.equal(responseReplyMock.mock.callCount(), 1);
    const [replyCall] = responseReplyMock.mock.calls;
    assert.ok(replyCall);
    const [replyMessage, replyOptions] = replyCall.arguments;
    assert.equal(replyMessage, MANUAL_REVIEW_MESSAGE);
    assert.ok(replyOptions && typeof replyOptions === 'object');
    if (replyOptions && typeof replyOptions === 'object') {
      const params = (replyOptions as { reply_parameters?: { message_id?: number } }).reply_parameters;
      assert.ok(params);
      if (params) {
        assert.equal(params.message_id, 900);
      }
    }

    assert.equal(editMessageTextMock.mock.callCount(), 0);
    assert.ok(token);
    const stored = callbackMap.get(token!);
    assert.ok(stored);
    assert.equal(stored?.payload?.failed, true);
    assert.equal(stored?.payload?.status, 'pending');
  });

});
