import './helpers/setup-env';

import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import type { Telegraf } from 'telegraf';

import { autoDelete } from '../src/bot/middlewares/autoDelete';
import type { BotContext } from '../src/bot/types';
import { pool } from '../src/db';
import * as tgUtils from '../src/utils/tg';

import type { SupportForwardResult } from '../src/bot/services/support';

interface TelegramCall {
  method: string;
  args: any[];
}

const createMockTelegram = () => {
  const calls: TelegramCall[] = [];

  return {
    calls,
    api: {
      async sendMessage(chatId: number, text: string) {
        calls.push({ method: 'sendMessage', args: [chatId, text] });
        return { message_id: 401, chat: { id: chatId }, text };
      },
      async copyMessage(
        chatId: number,
        fromChatId: number,
        messageId: number,
        extra?: unknown,
      ) {
        calls.push({ method: 'copyMessage', args: [chatId, fromChatId, messageId, extra] });
        return { message_id: 402, chat: { id: chatId } };
      },
      async editMessageReplyMarkup(...args: any[]) {
        calls.push({ method: 'editMessageReplyMarkup', args });
        return true;
      },
    } as any,
  };
};

const originalQuery = pool.query.bind(pool);

const setPoolQuery = (fn: typeof pool.query) => {
  (pool as unknown as { query: typeof pool.query }).query = fn;
};

const createAuthState = (telegramId: number): BotContext['auth'] => ({
  user: {
    telegramId,
    username: undefined,
    firstName: undefined,
    lastName: undefined,
    phone: undefined,
    role: 'client',
    isVerified: false,
    isBlocked: false,
  },
  executor: {
    verifiedRoles: { courier: false, driver: false },
    hasActiveSubscription: false,
    isVerified: false,
  },
  isModerator: false,
});

const createSessionState = (): BotContext['session'] => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
  executor: {
    role: 'courier',
    verification: {
      courier: { status: 'idle', requiredPhotos: 2, uploadedPhotos: [] },
      driver: { status: 'idle', requiredPhotos: 2, uploadedPhotos: [] },
    },
    subscription: { status: 'idle' },
  },
  client: {
    taxi: { stage: 'idle' },
    delivery: { stage: 'idle' },
  },
  ui: {
    steps: {},
    homeActions: [],
  },
  support: {
    status: 'idle',
  },
});

type SupportModule = typeof import('../src/bot/services/support');

let __testing__: SupportModule['__testing__'];
let forwardSupportMessage: SupportModule['forwardSupportMessage'];
let registerSupportModerationBridge: SupportModule['registerSupportModerationBridge'];

async function importSupportModule() {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test-token';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? 'postgres://user:pass@localhost:5432/db';
  process.env.CITY_DEFAULT = process.env.CITY_DEFAULT ?? 'Алматы';
  process.env.KASPI_CARD = process.env.KASPI_CARD ?? '4400 0000 0000 0000';
  process.env.KASPI_NAME = process.env.KASPI_NAME ?? 'Freedom Bot';
  process.env.KASPI_PHONE = process.env.KASPI_PHONE ?? '+7 (700) 000-00-00';
  process.env.DRIVERS_CHANNEL_INVITE =
    process.env.DRIVERS_CHANNEL_INVITE ?? 'https://t.me/+freedom-bot-drivers';
  process.env.SUB_PRICE_7 = process.env.SUB_PRICE_7 ?? '5000';
  process.env.SUB_PRICE_15 = process.env.SUB_PRICE_15 ?? '9000';
  process.env.SUB_PRICE_30 = process.env.SUB_PRICE_30 ?? '16000';

  return import('../src/bot/services/support');
}

describe('support service', () => {
  before(async () => {
    const mod = await importSupportModule();
    __testing__ = mod.__testing__;
    forwardSupportMessage = mod.forwardSupportMessage;
    registerSupportModerationBridge = mod.registerSupportModerationBridge;
  });
  beforeEach(() => {
    __testing__.resetSupportState();
    setPoolQuery(originalQuery);
  });

  it('restores open threads from the database', async () => {
    const rows = [
      {
        id: 'thread-restore',
        user_chat_id: '1001',
        user_tg_id: '2002',
        user_message_id: 10,
        moderator_chat_id: '3003',
        moderator_message_id: 20,
        status: 'open',
      },
    ];

    setPoolQuery((async (text: string) => {
      if (/FROM\s+support_threads/i.test(text)) {
        return { rows } as any;
      }

      return { rows: [] } as any;
    }) as typeof pool.query);

    await __testing__.restoreSupportThreads();

    const state = __testing__.threadsById.get('thread-restore');
    assert.ok(state, 'thread should be tracked after restore');
    assert.equal(state?.userChatId, 1001);
    assert.equal(state?.moderatorMessageId, 20);
  });

  it('forwards support messages and records threads', async () => {
    const telegram = createMockTelegram();

    const capturedQueries: any[] = [];
    setPoolQuery(async (...args: any[]) => {
      capturedQueries.push(args);
      return { rows: [] } as any;
    });

    __testing__.setModerationChannelResolver(async () => 987654321);

    const ctx = {
      chat: { id: 111 },
      from: {
        id: 222,
        username: 'support_user',
        first_name: 'Support',
        last_name: 'User',
      },
      message: { message_id: 123, text: 'Нужна помощь' },
      telegram: telegram.api,
      auth: createAuthState(222),
    } as unknown as BotContext;

    const result = (await forwardSupportMessage(ctx)) as SupportForwardResult;
    assert.equal(result.status, 'forwarded');
    assert.ok(result.threadId);

    const copyCall = telegram.calls.find((call) => call.method === 'copyMessage');
    assert.ok(copyCall, 'copyMessage should be invoked');
    assert.equal(copyCall?.args[0], 987654321);
    assert.equal(copyCall?.args[1], 111);
    assert.equal(copyCall?.args[2], 123);

    const options = copyCall?.args[3];
    assert.ok(options?.reply_markup, 'inline keyboard is attached');
    assert.equal(options?.reply_to_message_id, 401);

    assert.ok(
      capturedQueries.some((entry) =>
        typeof entry?.[0] === 'string' && entry[0].includes('INSERT INTO support_threads'),
      ),
      'support thread insert query should be executed',
    );

    const state = __testing__.threadsById.get(result.threadId!);
    assert.ok(state, 'thread state is tracked');
    assert.equal(state?.moderatorMessageId, 402);
  });

  it('prompts moderators for replies and delivers responses', async () => {
    const threadId = 'thread-reply';
    const telegram = createMockTelegram();

    __testing__.threadsById.set(threadId, {
      id: threadId,
      userChatId: 321,
      userMessageId: 5,
      userTelegramId: 654,
      moderatorChatId: 99,
      moderatorMessageId: 77,
      status: 'open',
    });

    const ctx = {
      chat: { id: 99 },
      from: { id: 555 },
      reply: async () => ({
        chat: { id: 99 },
        message_id: 500,
      }),
      answerCbQuery: async () => {},
      telegram: telegram.api,
      auth: createAuthState(555),
    } as unknown as BotContext;

    await __testing__.handleReplyAction(ctx, threadId);

    const promptKey = `${ctx.chat!.id}:${500}`;
    assert.ok(__testing__.pendingReplyPrompts.has(promptKey));

    const replyCtx = {
      chat: { id: 99 },
      from: { id: 555 },
      message: {
        message_id: 600,
        text: 'Ответ пользователю',
        reply_to_message: { message_id: 500 },
      },
      reply: async () => {},
      telegram: telegram.api,
      auth: createAuthState(555),
    } as unknown as BotContext;

    const handled = await __testing__.handleModeratorReplyMessage(replyCtx);
    assert.equal(handled, true);

    const delivered = telegram.calls.find((call) => call.method === 'copyMessage');
    assert.ok(delivered, 'reply should be copied to the user');
    assert.equal(delivered?.args[0], 321);
    assert.equal(__testing__.pendingReplyPrompts.size, 0);
  });

  it('closes support threads and cleans up state', async () => {
    const threadId = 'thread-close';
    const telegram = createMockTelegram();

    const updateQueries: any[] = [];
    setPoolQuery(async (...args: any[]) => {
      updateQueries.push(args);
      return { rows: [] } as any;
    });

    __testing__.threadsById.set(threadId, {
      id: threadId,
      userChatId: 654,
      userMessageId: 10,
      userTelegramId: 654,
      moderatorChatId: 4321,
      moderatorMessageId: 765,
      status: 'open',
    });

    const ctx = {
      chat: { id: 4321 },
      from: { id: 777 },
      answerCbQuery: async () => {},
      telegram: telegram.api,
      auth: createAuthState(777),
    } as unknown as BotContext;

    await __testing__.handleCloseAction(ctx, threadId);

    assert.ok(
      updateQueries.some((entry) =>
        typeof entry?.[0] === 'string' && entry[0].includes('UPDATE support_threads'),
      ),
      'update query should be executed when closing a thread',
    );

    assert.equal(__testing__.threadsById.has(threadId), false, 'thread state should be cleared');

    const notifyCall = telegram.calls.find((call) => call.method === 'sendMessage');
    assert.ok(notifyCall, 'user should be notified about closure');
    assert.equal(notifyCall?.args[0], 654);
  });

  it('keeps moderator replies when autoDelete middleware runs in group chats', async () => {
    const safeDeleteMock = mock.method(tgUtils, 'safeDeleteMessage', async () => true);

    try {
      const middleware = autoDelete();

      let messageHandler:
        | ((ctx: BotContext, next?: () => Promise<void>) => Promise<void>)
        | undefined;

      const bot = {
        action: () => bot,
        on(_: string, handler: (ctx: BotContext, next?: () => Promise<void>) => Promise<void>) {
          messageHandler = handler;
          return bot;
        },
      } as unknown as Telegraf<BotContext>;

      registerSupportModerationBridge(bot);

      assert.ok(messageHandler, 'message handler should be registered');

      const threadId = 'thread-auto-delete';
      const moderatorChatId = -100987654;
      const promptMessageId = 500;

      __testing__.threadsById.set(threadId, {
        id: threadId,
        userChatId: 1234,
        userTelegramId: 4321,
        userMessageId: 45,
        moderatorChatId,
        moderatorMessageId: 400,
        status: 'open',
      });

      __testing__.registerPrompt(threadId, moderatorChatId, promptMessageId, 777);

      const copyMessage = mock.fn(async () => ({ message_id: 901 }));
      const deleteMessage = mock.fn(async () => true);
      const reply = mock.fn(async () => ({ message_id: 902 }));

      const session = createSessionState();

      const authState = createAuthState(777);
      authState.isModerator = true;

      const ctx = {
        chat: { id: moderatorChatId, type: 'supergroup' as const },
        from: { id: 777 },
        message: {
          message_id: 903,
          text: 'Ответ пользователю',
          chat: { id: moderatorChatId, type: 'supergroup' as const },
          reply_to_message: { message_id: promptMessageId },
        },
        telegram: { copyMessage, deleteMessage },
        reply,
        session,
        auth: authState,
      } as unknown as BotContext;

      let handlerInvoked = false;
      await middleware(ctx, async () => {
        handlerInvoked = true;
        await messageHandler!(ctx);
      });

      assert.equal(handlerInvoked, true, 'support bridge handler should process the message');
      assert.equal(copyMessage.mock.callCount(), 1, 'moderator reply should be delivered');
      assert.equal(reply.mock.callCount(), 1, 'moderator should receive acknowledgement');
      assert.equal(safeDeleteMock.mock.callCount(), 0, 'autoDelete should not remove group messages');
      assert.equal(deleteMessage.mock.callCount(), 0, 'telegram deleteMessage should not be called');
    } finally {
      safeDeleteMock.mock.restore();
    }
  });

  it('registers handlers on a Telegraf instance', async () => {
    const actions: { pattern: RegExp; handler: (ctx: BotContext) => Promise<void> }[] = [];
    let messageHandler: ((ctx: BotContext, next?: () => Promise<void>) => Promise<void>) | null =
      null;

    const bot = {
      action(pattern: RegExp, handler: (ctx: BotContext) => Promise<void>) {
        actions.push({ pattern, handler });
      },
      on(_: string, handler: typeof messageHandler) {
        messageHandler = handler;
      },
    } as unknown as Telegraf<BotContext>;

    registerSupportModerationBridge(bot);

    assert.equal(actions.length, 2, 'two action handlers are registered');
    assert.ok(messageHandler, 'message handler should be registered');
  });
});
