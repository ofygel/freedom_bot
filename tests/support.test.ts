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
  let nextMessageId = 401;

  return {
    calls,
    api: {
      async sendMessage(chatId: number, text: string, extra?: unknown) {
        calls.push({ method: 'sendMessage', args: [chatId, text, extra] });
        const messageId = nextMessageId;
        nextMessageId += 1;
        return { message_id: messageId, chat: { id: chatId }, text };
      },
      async copyMessage(
        chatId: number,
        fromChatId: number,
        messageId: number,
        extra?: unknown,
      ) {
        calls.push({ method: 'copyMessage', args: [chatId, fromChatId, messageId, extra] });
        const nextId = nextMessageId;
        nextMessageId += 1;
        return { message_id: nextId, chat: { id: chatId } };
      },
      async editMessageReplyMarkup(...args: any[]) {
        calls.push({ method: 'editMessageReplyMarkup', args });
        return true;
      },
      async sendPhoto(chatId: number, photo: string, extra?: unknown) {
        calls.push({ method: 'sendPhoto', args: [chatId, photo, extra] });
        const messageId = nextMessageId;
        nextMessageId += 1;
        return { message_id: messageId, chat: { id: chatId } };
      },
      async sendDocument(chatId: number, document: string, extra?: unknown) {
        calls.push({ method: 'sendDocument', args: [chatId, document, extra] });
        const messageId = nextMessageId;
        nextMessageId += 1;
        return { message_id: messageId, chat: { id: chatId } };
      },
      async sendVideo(chatId: number, video: string, extra?: unknown) {
        calls.push({ method: 'sendVideo', args: [chatId, video, extra] });
        const messageId = nextMessageId;
        nextMessageId += 1;
        return { message_id: messageId, chat: { id: chatId } };
      },
      async sendAudio(chatId: number, audio: string, extra?: unknown) {
        calls.push({ method: 'sendAudio', args: [chatId, audio, extra] });
        const messageId = nextMessageId;
        nextMessageId += 1;
        return { message_id: messageId, chat: { id: chatId } };
      },
      async sendVoice(chatId: number, voice: string, extra?: unknown) {
        calls.push({ method: 'sendVoice', args: [chatId, voice, extra] });
        const messageId = nextMessageId;
        nextMessageId += 1;
        return { message_id: messageId, chat: { id: chatId } };
      },
      async sendAnimation(chatId: number, animation: string, extra?: unknown) {
        calls.push({ method: 'sendAnimation', args: [chatId, animation, extra] });
        const messageId = nextMessageId;
        nextMessageId += 1;
        return { message_id: messageId, chat: { id: chatId } };
      },
      async sendVideoNote(chatId: number, videoNote: string, extra?: unknown) {
        calls.push({ method: 'sendVideoNote', args: [chatId, videoNote, extra] });
        const messageId = nextMessageId;
        nextMessageId += 1;
        return { message_id: messageId, chat: { id: chatId } };
      },
      async sendSticker(chatId: number, sticker: string, extra?: unknown) {
        calls.push({ method: 'sendSticker', args: [chatId, sticker, extra] });
        const messageId = nextMessageId;
        nextMessageId += 1;
        return { message_id: messageId, chat: { id: chatId } };
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
    phoneVerified: false,
    role: 'client',
    status: 'active_client',
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
  authSnapshot: {
    role: 'guest' as const,
    status: 'guest' as const,
    phoneVerified: false,
    userIsVerified: false,
    executor: {
      verifiedRoles: { courier: false, driver: false },
      hasActiveSubscription: false,
      isVerified: false,
    },
    city: undefined,
    stale: false,
  },
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

    const auth = createAuthState(222);
    auth.user.phone = '+7 700 000 00 00';

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
      auth,
    } as unknown as BotContext;

    const result = (await forwardSupportMessage(ctx)) as SupportForwardResult;
    assert.equal(result.status, 'forwarded');
    assert.ok(result.threadId);

    const headerCall = telegram.calls.find((call) => call.method === 'sendMessage');
    assert.ok(headerCall, 'support header should be sent to the moderation chat');
    assert.equal(headerCall?.args[0], 987654321);
    assert.equal(
      headerCall?.args[1],
      [
        '🆘 Новое обращение в поддержку',
        `ID обращения: ${result.threadId}`,
        'Telegram ID: 222',
        'Username: @support_user',
        'Имя: Support User',
        'Телефон: +7 700 000 00 00',
      ].join('\n'),
    );

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

  it('returns missing_channel when moderation resolver throws without fallback', async () => {
    const telegram = createMockTelegram();

    __testing__.setModerationChannelResolver(async () => {
      throw new Error('db unavailable');
    });

    const ctx = {
      chat: { id: 111 },
      from: { id: 222 },
      message: { message_id: 321, text: 'Помогите' },
      telegram: telegram.api,
      auth: createAuthState(222),
    } as unknown as BotContext;

    const result = (await forwardSupportMessage(ctx)) as SupportForwardResult;

    assert.equal(result.status, 'missing_channel');
    assert.equal(telegram.calls.length, 0);
  });

  it('uses the cached moderation chat when resolver fails', async () => {
    const telegram = createMockTelegram();
    const queries: string[] = [];

    setPoolQuery((async (text: string) => {
      queries.push(text);
      return { rows: [] } as any;
    }) as typeof pool.query);

    __testing__.setModerationChannelResolver(async () => 987654321);

    const auth = createAuthState(222);
    auth.user.phone = '+7 777 000 00 00';

    const firstCtx = {
      chat: { id: 111 },
      from: { id: 222 },
      message: { message_id: 1111, text: 'Нужна помощь' },
      telegram: telegram.api,
      auth,
    } as unknown as BotContext;

    const firstResult = (await forwardSupportMessage(firstCtx)) as SupportForwardResult;
    assert.equal(firstResult.status, 'forwarded');

    __testing__.setModerationChannelResolver(async () => {
      throw new Error('db down');
    });

    const secondCtx = {
      chat: { id: 112 },
      from: { id: 223 },
      message: { message_id: 1112, text: 'Снова нужна помощь' },
      telegram: telegram.api,
      auth: createAuthState(223),
    } as unknown as BotContext;

    const secondResult = (await forwardSupportMessage(secondCtx)) as SupportForwardResult;

    assert.equal(secondResult.status, 'forwarded');
    assert.equal(__testing__.getLastKnownModerationChatId(), 987654321);

    const headerCalls = telegram.calls.filter((call) => call.method === 'sendMessage');
    assert.equal(headerCalls.length, 2);
    assert.equal(headerCalls[0]?.args[0], 987654321);
    assert.equal(headerCalls[1]?.args[0], 987654321);

    const copyCalls = telegram.calls.filter((call) => call.method === 'copyMessage');
    assert.equal(copyCalls.length, 2);
    assert.equal(copyCalls[0]?.args[0], 987654321);
    assert.equal(copyCalls[1]?.args[0], 987654321);

    assert.ok(
      queries.some((text) => text.includes('INSERT INTO support_threads')),
      'support threads should be persisted',
    );
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

  it('falls back to plain prompts when force reply is unavailable', async () => {
    const threadId = 'thread-fallback';
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

    let replyCalls = 0;
    const sentMessages: { text: string; extra?: unknown }[] = [];
    const reply = mock.fn(async (text: string, extra?: unknown) => {
      replyCalls += 1;
      if (replyCalls === 1) {
        const error = new Error('Bad Request: inline keyboard expected');
        (error as any).response = { description: 'Bad Request: inline keyboard expected' };
        throw error;
      }

      sentMessages.push({ text, extra });
      return { chat: { id: 99 }, message_id: 700, text };
    });

    const ctx = {
      chat: { id: 99 },
      from: { id: 555 },
      reply,
      answerCbQuery: async () => {},
      telegram: telegram.api,
      auth: createAuthState(555),
    } as unknown as BotContext;

    await __testing__.handleReplyAction(ctx, threadId);

    assert.equal(reply.mock.callCount(), 2);
    assert.equal(sentMessages.length, 1);
    assert.equal(
      sentMessages[0]?.text,
      'Отправьте ответ пользователю сообщением. Это сообщение будет доставлено в личные сообщения.\n\nОтветьте на это сообщение, чтобы отправить ответ пользователю.',
    );
    assert.equal(sentMessages[0]?.extra, undefined);

    const promptKey = `${ctx.chat!.id}:700`;
    assert.ok(__testing__.pendingReplyPrompts.has(promptKey));

    const replyCtx = {
      chat: { id: 99 },
      from: { id: 555 },
      message: {
        message_id: 800,
        text: 'Ответ пользователю',
      },
      telegram: telegram.api,
      reply: async () => {},
      auth: createAuthState(555),
    } as unknown as BotContext;

    const handled = await __testing__.handleModeratorReplyMessage(replyCtx);
    assert.equal(handled, true);

    const delivered = telegram.calls.find((call) => call.method === 'copyMessage');
    assert.ok(delivered, 'reply should be copied to the user');
    assert.equal(__testing__.pendingReplyPrompts.size, 0);
  });

  it('delivers moderator replies sent as channel posts', async () => {
    const threadId = 'thread-channel-post';
    const moderatorChatId = -100123456;
    const promptMessageId = 700;
    const telegram = createMockTelegram();

    __testing__.threadsById.set(threadId, {
      id: threadId,
      userChatId: 321,
      userMessageId: 5,
      userTelegramId: 654,
      moderatorChatId,
      moderatorMessageId: 77,
      status: 'open',
    });

    __testing__.registerPrompt(threadId, moderatorChatId, promptMessageId);

    const reply = mock.fn(async () => ({
      message_id: 801,
      chat: { id: moderatorChatId },
      text: 'OK',
    }));

    const replyCtx = {
      chat: { id: moderatorChatId, type: 'channel' as const },
      channelPost: {
        message_id: 800,
        text: 'Ответ пользователю',
        chat: { id: moderatorChatId, type: 'channel' as const },
        reply_to_message: { message_id: promptMessageId },
      },
      telegram: telegram.api,
      reply,
      auth: createAuthState(9999),
    } as unknown as BotContext;

    const handled = await __testing__.handleModeratorReplyMessage(replyCtx);
    assert.equal(handled, true, 'channel post reply should be processed');

    const delivered = telegram.calls.find((call) => call.method === 'copyMessage');
    assert.ok(delivered, 'reply should be copied to the user');
    assert.equal(delivered?.args[0], 321);
    assert.equal(reply.mock.callCount(), 1, 'moderator should receive acknowledgement');
  });

  it('delivers discussion replies using the channel sender chat context', async () => {
    const threadId = 'thread-discussion-sender';
    const channelChatId = -100654321;
    const discussionChatId = -200654321;
    const promptMessageId = 900;
    const telegram = createMockTelegram();

    __testing__.threadsById.set(threadId, {
      id: threadId,
      userChatId: 321,
      userMessageId: 5,
      userTelegramId: 654,
      moderatorChatId: channelChatId,
      moderatorMessageId: 77,
      status: 'open',
    });

    __testing__.registerPrompt(threadId, channelChatId, promptMessageId, undefined, {
      additionalChatIds: [discussionChatId],
    });

    const acknowledgements: string[] = [];

    const replyCtx = {
      chat: { id: discussionChatId, type: 'supergroup' as const },
      from: { id: 987654 },
      message: {
        message_id: 901,
        text: 'Ответ пользователю',
        chat: { id: discussionChatId, type: 'supergroup' as const },
        reply_to_message: {
          message_id: promptMessageId,
          sender_chat: { id: channelChatId, type: 'channel' as const },
        },
      },
      telegram: telegram.api,
      reply: async (text: string) => {
        acknowledgements.push(text);
        return { message_id: 902, chat: { id: discussionChatId }, text };
      },
      auth: createAuthState(987654),
    } as unknown as BotContext;

    const handled = await __testing__.handleModeratorReplyMessage(replyCtx);
    assert.equal(handled, true, 'reply should be processed when sender_chat matches channel');

    const delivered = telegram.calls.find((call) => call.method === 'copyMessage');
    assert.ok(delivered, 'reply should be copied to the user');
    assert.equal(delivered?.args[0], 321);
    assert.equal(delivered?.args[1], discussionChatId);

    assert.deepEqual(acknowledgements, ['Ответ доставлен пользователю.']);
    assert.equal(__testing__.pendingReplyPrompts.size, 0);
  });

  it('matches discussion replies to forwarded channel posts', async () => {
    const telegram = createMockTelegram();

    setPoolQuery(async () => ({ rows: [] }) as any);

    const channelChatId = -100222333;
    const discussionChatId = -200222333;
    const moderatorId = 424242;

    __testing__.setModerationChannelResolver(async () => channelChatId);

    const forwardCtx = {
      chat: { id: 3030 },
      from: { id: 8080, first_name: 'Client' },
      message: { message_id: 5050, text: 'Нужна помощь' },
      telegram: telegram.api,
      auth: createAuthState(8080),
    } as unknown as BotContext;

    const forwardResult = (await forwardSupportMessage(forwardCtx)) as SupportForwardResult;
    assert.equal(forwardResult.status, 'forwarded');
    const threadId = forwardResult.threadId;
    assert.ok(threadId, 'thread id should be returned after forwarding');

    const state = __testing__.threadsById.get(threadId!);
    assert.ok(state, 'thread state should be tracked for forwarded messages');

    const acknowledgements: string[] = [];

    const replyCtx = {
      chat: { id: discussionChatId, type: 'supergroup' as const },
      from: { id: moderatorId },
      message: {
        message_id: 9090,
        text: 'Ответ пользователю',
        chat: { id: discussionChatId, type: 'supergroup' as const },
        reply_to_message: {
          message_id: state!.moderatorMessageId,
          sender_chat: { id: channelChatId, type: 'channel' as const },
        },
      },
      telegram: telegram.api,
      reply: async (text: string) => {
        acknowledgements.push(text);
        return { message_id: 9191, chat: { id: discussionChatId }, text };
      },
      auth: createAuthState(moderatorId),
    } as unknown as BotContext;

    const handled = await __testing__.handleModeratorReplyMessage(replyCtx);
    assert.equal(
      handled,
      true,
      'discussion reply referencing the channel should be processed',
    );

    const copyCalls = telegram.calls.filter((call) => call.method === 'copyMessage');
    assert.equal(copyCalls.length, 2, 'moderator reply should trigger a second copyMessage call');

    const replyCopy = copyCalls.at(-1);
    assert.ok(replyCopy, 'reply copy should exist');
    assert.equal(replyCopy?.args[0], state!.userChatId);
    assert.equal(replyCopy?.args[1], discussionChatId);

    assert.deepEqual(acknowledgements, ['Ответ доставлен пользователю.']);
    assert.equal(__testing__.pendingReplyPrompts.size, 0);
  });

  it('delivers replies when responding to the forwarded message directly', async () => {
    const telegram = createMockTelegram();

    setPoolQuery(async () => ({ rows: [] }) as any);
    __testing__.setModerationChannelResolver(async () => 777777);

    const forwardCtx = {
      chat: { id: 1111 },
      from: { id: 2222, first_name: 'Client' },
      message: { message_id: 3333, text: 'Помогите' },
      telegram: telegram.api,
      auth: createAuthState(2222),
    } as unknown as BotContext;

    const forwardResult = (await forwardSupportMessage(forwardCtx)) as SupportForwardResult;
    assert.equal(forwardResult.status, 'forwarded');
    const threadId = forwardResult.threadId;
    assert.ok(threadId, 'thread id should be returned');

    const state = __testing__.threadsById.get(threadId!);
    assert.ok(state, 'thread state should be tracked for direct replies');

    const acknowledgements: string[] = [];
    const replyCtx = {
      chat: { id: state!.moderatorChatId },
      from: { id: 9999 },
      message: {
        message_id: 4444,
        text: 'Ответ пользователю',
        reply_to_message: { message_id: state!.moderatorMessageId },
      },
      telegram: telegram.api,
      reply: async (text: string) => {
        acknowledgements.push(text);
        return { message_id: 5555, chat: { id: state!.moderatorChatId }, text };
      },
      auth: createAuthState(9999),
    } as unknown as BotContext;

    const handled = await __testing__.handleModeratorReplyMessage(replyCtx);
    assert.equal(handled, true, 'reply should be processed');

    const copyCalls = telegram.calls.filter((call) => call.method === 'copyMessage');
    assert.equal(copyCalls.length, 2, 'reply should trigger another copyMessage call');
    const lastCopy = copyCalls.at(-1);
    assert.ok(lastCopy, 'reply copy should exist');
    assert.equal(lastCopy?.args[0], state!.userChatId);
    assert.equal(acknowledgements.length, 1);
    assert.equal(acknowledgements[0], 'Ответ доставлен пользователю.');
  });

  it('resends moderator replies when copyMessage is unavailable', async () => {
    const threadId = 'thread-manual-resend';
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

    const promptMessageId = 700;
    __testing__.registerPrompt(threadId, 99, promptMessageId);

    const copyError = new Error('Bad Request: message can\'t be forwarded');
    (copyError as any).response = { description: 'Bad Request: message can\'t be forwarded' };

    telegram.api.copyMessage = async (...args: any[]) => {
      telegram.calls.push({ method: 'copyMessage', args });
      throw copyError;
    };

    const acknowledgements: string[] = [];

    const messageEntities = [{ type: 'bold', offset: 0, length: 5 }];

    const replyCtx = {
      chat: { id: 99 },
      from: { id: 555 },
      message: {
        message_id: 880,
        text: 'Ответ пользователю',
        entities: messageEntities,
        reply_to_message: { message_id: promptMessageId },
      },
      telegram: telegram.api,
      reply: async (text: string) => {
        acknowledgements.push(text);
        return { message_id: 881, chat: { id: 99 }, text };
      },
      auth: createAuthState(555),
    } as unknown as BotContext;

    const handled = await __testing__.handleModeratorReplyMessage(replyCtx);
    assert.equal(handled, true, 'fallback should deliver the reply');

    const sendCall = telegram.calls.find((call) => call.method === 'sendMessage');
    assert.ok(sendCall, 'sendMessage should be used when copyMessage fails');
    assert.equal(sendCall?.args[0], 321);
    assert.equal(sendCall?.args[1], 'Ответ пользователю');
    assert.deepEqual(sendCall?.args[2]?.entities, messageEntities);

    const copyCalls = telegram.calls.filter((call) => call.method === 'copyMessage');
    assert.equal(copyCalls.length, 1, 'copyMessage should still be attempted once');
    assert.deepEqual(acknowledgements, ['Ответ доставлен пользователю.']);
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
    const onHandlers: {
      event: string;
      handler: (ctx: BotContext, next?: () => Promise<void>) => Promise<void>;
    }[] = [];

    const bot = {
      action(pattern: RegExp, handler: (ctx: BotContext) => Promise<void>) {
        actions.push({ pattern, handler });
        return bot;
      },
      on(event: string, handler: (ctx: BotContext, next?: () => Promise<void>) => Promise<void>) {
        onHandlers.push({ event, handler });
        return bot;
      },
    } as unknown as Telegraf<BotContext>;

    registerSupportModerationBridge(bot);

    assert.equal(actions.length, 2, 'two action handlers are registered');
    assert.equal(onHandlers.length, 2, 'handlers for messages and channel posts are registered');
    assert.deepEqual(
      onHandlers
        .map((entry) => entry.event)
        .sort(),
      ['channel_post', 'message'],
      'message and channel_post handlers are attached',
    );
    assert.ok(onHandlers.every((entry) => typeof entry.handler === 'function'));
  });
});
