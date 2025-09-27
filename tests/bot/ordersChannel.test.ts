import '../helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import type { Telegraf } from 'telegraf';
import type { BotContext } from '../../src/bot/types';
import type { OrderRecord } from '../../src/types';
import * as dbClient from '../../src/db/client';
import * as ordersDb from '../../src/db/orders';
import * as bindings from '../../src/bot/channels/bindings';
import * as feedback from '../../src/bot/services/feedback';
import * as reports from '../../src/bot/services/reports';
import { copy } from '../../src/bot/copy';
import * as idempotency from '../../src/bot/middlewares/idempotency';

let ordersChannel: typeof import('../../src/bot/channels/ordersChannel');

const createOrderRecord = (overrides: Partial<OrderRecord> = {}): OrderRecord => ({
  id: 101,
  shortId: 'ORD-101',
  kind: 'delivery',
  status: 'open',
  city: 'almaty',
  pickup: {
    query: 'Start point',
    address: 'Start point address',
    latitude: 43.2,
    longitude: 76.9,
  },
  dropoff: {
    query: 'Finish point',
    address: 'Finish point address',
    latitude: 43.25,
    longitude: 76.95,
  },
  price: {
    amount: 3500,
    currency: 'KZT',
    distanceKm: 5.5,
    etaMinutes: 15,
  },
  createdAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

const createTelegram = () => {
  const deleteMessage = mock.fn<(chatId: number | string, messageId: number) => Promise<true>>(
    async () => true as const,
  );
  const editMessageText = mock.fn<
    (chatId: number | string, messageId: number, inlineId: undefined, text: string) => Promise<true>
  >(async () => true as const);
  const editMessageReplyMarkup = mock.fn<
    (chatId: number | string, messageId: number, inlineId: undefined, markup: unknown) => Promise<true>
  >(async () => true as const);
  const sendMessage = mock.fn<
    (chatId: number | string, text: string, extra?: unknown) => Promise<{ message_id: number }>
  >(async () => ({ message_id: 900 }));

  return {
    telegram: {
      deleteMessage: deleteMessage as unknown,
      editMessageText: editMessageText as unknown,
      editMessageReplyMarkup: editMessageReplyMarkup as unknown,
      sendMessage: sendMessage as unknown,
    },
    deleteMessage,
    editMessageText,
    editMessageReplyMarkup,
    sendMessage,
  };
};

describe('orders channel callbacks', () => {
  let withTxMock: ReturnType<typeof mock.method> | undefined;
  let lockOrderByIdMock: ReturnType<typeof mock.method> | undefined;
  let tryClaimOrderMock: ReturnType<typeof mock.method> | undefined;
  let getChannelBindingMock: ReturnType<typeof mock.method> | undefined;
  let feedbackMock: ReturnType<typeof mock.method> | undefined;
  let reportClaimedMock: ReturnType<typeof mock.method> | undefined;

  before(async () => {
    ordersChannel = await import('../../src/bot/channels/ordersChannel');
  });

  beforeEach(() => {
    ordersChannel.__testing.reset();
  });

  afterEach(() => {
    withTxMock?.mock.restore();
    lockOrderByIdMock?.mock.restore();
    tryClaimOrderMock?.mock.restore();
    getChannelBindingMock?.mock.restore();
    feedbackMock?.mock.restore();
    reportClaimedMock?.mock.restore();

    withTxMock = undefined;
    lockOrderByIdMock = undefined;
    tryClaimOrderMock = undefined;
    getChannelBindingMock = undefined;
    feedbackMock = undefined;
    reportClaimedMock = undefined;
  });

  const createContext = (options: {
    orderId: number;
    chatId: number;
    messageId: number;
    userId: number;
    city?: string;
    chatType?: 'private' | 'channel' | 'supergroup';
  }) => {
    const {
      orderId,
      chatId,
      messageId,
      userId,
      city = 'almaty',
      chatType = 'channel',
    } = options;

    const answerCbQuery = mock.fn<
      (text: string, extra?: { show_alert?: boolean }) => Promise<void>
    >(async () => undefined);

    const { telegram, deleteMessage, editMessageText, editMessageReplyMarkup, sendMessage } =
      createTelegram();

    const ctx = {
      callbackQuery: {
        id: 'cbq-1',
        data: `order:accept:${orderId}`,
        message: {
          message_id: messageId,
          chat: { id: chatId, type: chatType },
        },
      },
      match: [`order:accept:${orderId}`, String(orderId)] as unknown,
      from: { id: userId, is_bot: false, first_name: 'Driver' },
      telegram,
      answerCbQuery,
      auth: {
        user: {
          telegramId: userId,
          role: 'driver' as const,
          status: 'active_executor' as const,
          isVerified: true,
          isBlocked: false,
          citySelected: city,
        },
        executor: {
          verifiedRoles: { courier: false, driver: true },
          hasActiveSubscription: true,
          isVerified: true,
        },
        isModerator: false,
      },
    } as unknown as BotContext & {
      callbackQuery: NonNullable<BotContext['callbackQuery']> & {
        message: NonNullable<BotContext['callbackQuery']>['message'];
      };
    };

    return {
      ctx,
      answerCbQuery,
      deleteMessage,
      editMessageText,
      editMessageReplyMarkup,
      sendMessage,
    };
  };

  it('allows drivers channel callbacks to claim the order', async () => {
    const orderId = 555;
    const chatId = -100123456;
    const messageId = 42;
    const userId = 9001;

    const order = createOrderRecord({ id: orderId, shortId: 'ABC-123' });
    const claimedOrder = createOrderRecord({
      ...order,
      status: 'claimed',
      claimedBy: userId,
    });

    const client = {
      query: mock.fn(async (text: string) => {
        if (text.includes('FROM users')) {
          return { rows: [{ tg_id: userId }] };
        }
        if (text.includes('FROM orders')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    withTxMock = mock.method(dbClient, 'withTx', async (callback: any) => callback(client));
    lockOrderByIdMock = mock.method(ordersDb, 'lockOrderById', async () => order);
    tryClaimOrderMock = mock.method(ordersDb, 'tryClaimOrder', async () => claimedOrder);
    getChannelBindingMock = mock.method(bindings, 'getChannelBinding', async () => ({
      type: 'drivers',
      chatId,
    }));
    feedbackMock = mock.method(feedback, 'sendProcessingFeedback', async () => undefined);
    reportClaimedMock = mock.method(reports, 'reportOrderClaimed', async () => undefined);

    ordersChannel.__testing.orderStates.set(orderId, {
      orderId,
      chatId,
      messageId,
      baseText: 'order message',
      status: 'pending',
    });

    const { ctx, answerCbQuery, sendMessage } = createContext({
      orderId,
      chatId,
      messageId,
      userId,
    });

    await ordersChannel.__testing.handleOrderDecision(ctx, orderId, 'accept');

    assert.ok(withTxMock);
    assert.ok(lockOrderByIdMock);
    assert.ok(tryClaimOrderMock);
    assert.ok(feedbackMock);
    assert.ok(reportClaimedMock);

    assert.equal(withTxMock.mock.callCount(), 1);
    assert.equal(lockOrderByIdMock.mock.callCount(), 1);
    assert.equal(tryClaimOrderMock.mock.callCount(), 1);
    assert.equal(feedbackMock.mock.callCount(), 1);
    assert.equal(reportClaimedMock.mock.callCount(), 1);

    assert.equal(answerCbQuery.mock.callCount(), 1);
    const [answerCall] = answerCbQuery.mock.calls;
    assert.ok(answerCall);
    assert.equal(answerCall.arguments[0], copy.orderAcceptedToast);

    assert.equal(sendMessage.mock.callCount(), 1);
    const state = ordersChannel.__testing.orderStates.get(orderId);
    assert.ok(state);
    assert.equal(state?.status, 'claimed');
  });

  it('rejects callbacks coming from unrelated chats', async () => {
    const orderId = 777;
    const driversChatId = -100777;

    const order = createOrderRecord({ id: orderId });
    ordersChannel.__testing.orderStates.set(orderId, {
      orderId,
      chatId: driversChatId,
      messageId: 99,
      baseText: 'order message',
      status: 'pending',
    });

    lockOrderByIdMock = mock.method(ordersDb, 'lockOrderById', async () => order);
    tryClaimOrderMock = mock.method(ordersDb, 'tryClaimOrder', async () => ({
      ...order,
      status: 'claimed',
      claimedBy: 123,
    }));
    withTxMock = mock.method(dbClient, 'withTx', async (callback: any) =>
      callback({ query: async () => ({ rows: [] }) }),
    );
    getChannelBindingMock = mock.method(bindings, 'getChannelBinding', async () => ({
      type: 'drivers',
      chatId: driversChatId,
    }));
    feedbackMock = mock.method(feedback, 'sendProcessingFeedback', async () => undefined);

    const foreignChatId = -100999;
    const { ctx, answerCbQuery } = createContext({
      orderId,
      chatId: foreignChatId,
      messageId: 55,
      userId: 321,
    });

    await ordersChannel.__testing.handleOrderDecision(ctx, orderId, 'accept');

    assert.equal(answerCbQuery.mock.callCount(), 1);
    const [answerCall] = answerCbQuery.mock.calls;
    assert.ok(answerCall);
    assert.equal(answerCall.arguments[0], 'Действие доступно только в личном чате с ботом.');
    assert.deepEqual(answerCall.arguments[1], { show_alert: true });

    assert.ok(feedbackMock);
    assert.ok(withTxMock);
    assert.ok(lockOrderByIdMock);
    assert.ok(tryClaimOrderMock);

    assert.equal(feedbackMock.mock.callCount(), 0);
    assert.equal(withTxMock.mock.callCount(), 0);
    assert.equal(lockOrderByIdMock.mock.callCount(), 0);
    assert.equal(tryClaimOrderMock.mock.callCount(), 0);
  });
});

describe('registerOrdersChannel', () => {
  let withIdempotencyMock: ReturnType<typeof mock.method> | undefined;

  before(async () => {
    ordersChannel = await import('../../src/bot/channels/ordersChannel');
  });

  afterEach(() => {
    withIdempotencyMock?.mock.restore();
    withIdempotencyMock = undefined;
  });

  it('answers callback with duplicate warning when idempotency guard detects repeat', async () => {
    const actions: Array<{ pattern: RegExp; handler: (ctx: BotContext) => Promise<void> }> = [];
    const bot = {
      action: (pattern: RegExp, handler: (ctx: BotContext) => Promise<void>) => {
        actions.push({ pattern, handler });
        return bot;
      },
    };

    ordersChannel.registerOrdersChannel(bot as unknown as Telegraf<BotContext>);

    const acceptAction = actions.find(({ pattern }) => pattern.test('order:accept:42'));
    assert.ok(acceptAction, 'accept handler should be registered');

    const answerCbQuery = mock.fn<(text?: string, extra?: { show_alert?: boolean }) => Promise<void>>(
      async () => undefined,
    );
    const ctx = {
      match: ['order:accept:42', '42'] as unknown as RegExpMatchArray,
      answerCbQuery,
      from: { id: 12345 },
    } as unknown as BotContext;

    withIdempotencyMock = mock.method(idempotency, 'withIdempotency', async () => ({ status: 'duplicate' }));

    await acceptAction.handler(ctx);

    assert.ok(withIdempotencyMock);
    assert.equal(withIdempotencyMock.mock.callCount(), 1);

    assert.equal(answerCbQuery.mock.callCount(), 1);
    const [answerCall] = answerCbQuery.mock.calls;
    assert.ok(answerCall, 'answerCbQuery should be invoked');
    assert.equal(answerCall.arguments[0], 'Запрос уже обработан.');
    assert.deepEqual(answerCall.arguments[1], undefined);
  });
});
