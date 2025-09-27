import '../helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';
import type { Telegraf } from 'telegraf';

import type { BotContext } from '../../src/bot/types';
import type { OrderRecord } from '../../src/types';

interface ActionHandler {
  (ctx: BotContext & { match?: RegExpExecArray }): Promise<void>;
}

const createBot = () => {
  const actions: Array<{ pattern: string | RegExp; handler: ActionHandler }> = [];

  const bot = {
    action: (pattern: string | RegExp, handler: ActionHandler) => {
      actions.push({ pattern, handler });
      return bot;
    },
    hears: () => bot,
    command: () => bot,
    on: () => bot,
  } as unknown as Telegraf<BotContext>;

  return { bot, actions };
};

const findActionHandler = (
  actions: Array<{ pattern: string | RegExp; handler: ActionHandler }>,
  pattern: string | RegExp,
): ActionHandler => {
  const entry = actions.find((action) => {
    if (typeof pattern === 'string') {
      return action.pattern === pattern;
    }

    return action.pattern instanceof RegExp && action.pattern.source === pattern.source;
  });

  if (!entry) {
    throw new Error(`Handler for pattern ${pattern.toString()} not registered`);
  }

  return entry.handler;
};

const buildLocation = (address: string) => ({
  query: address,
  address,
  latitude: 43.238949,
  longitude: 76.889709,
});

const buildPrice = () => ({
  amount: 1500,
  currency: 'KZT',
  distanceKm: 12,
  etaMinutes: 25,
});

const createBaseContext = () => {
  const answeredCallbacks: Array<{ text?: string; options?: unknown }> = [];
  const session: BotContext['session'] = {
    ephemeralMessages: [],
    isAuthenticated: true,
    awaitingPhone: false,
    phoneNumber: '+77001234567',
    city: 'almaty',
    authSnapshot: {
      role: 'guest',
      status: 'guest',
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
        courier: { status: 'idle', requiredPhotos: 0, uploadedPhotos: [] },
        driver: { status: 'idle', requiredPhotos: 0, uploadedPhotos: [] },
      },
      subscription: { status: 'idle' },
    },
    client: {
      taxi: { stage: 'idle' },
      delivery: { stage: 'idle' },
    },
    ui: { steps: {}, homeActions: [] },
    support: { status: 'idle' },
  };

  const ctx = {
    chat: { id: 1001, type: 'private' as const },
    callbackQuery: { id: 'cb', message: { chat: { id: 1001, type: 'private' as const } } },
    from: { id: 2002, is_bot: false, first_name: 'Tester' },
    session,
    auth: {
      user: {
        telegramId: 2002,
        username: 'customer',
        firstName: 'Test',
        lastName: 'User',
        phoneVerified: true,
        role: 'client' as const,
        status: 'active_client' as const,
        isVerified: false,
        isBlocked: false,
        phone: '+77001234567',
      },
      executor: { verifiedRoles: { courier: false, driver: false }, hasActiveSubscription: false, isVerified: false },
      isModerator: false,
    },
    telegram: { sendChatAction: async () => undefined, deleteMessage: async () => true },
    answerCbQuery: async (text?: string, options?: unknown) => {
      answeredCallbacks.push({ text, options });
      return true;
    },
    reply: async () => ({ message_id: 1, chat: { id: 1001 }, date: Date.now() / 1000, text: '' }),
    update: {} as never,
    updateType: 'callback_query' as const,
    botInfo: {} as never,
    state: {},
  } as unknown as BotContext & { answerCbQuery: (text?: string, options?: unknown) => Promise<true> };

  return { ctx, session, answeredCallbacks };
};

const createTaxiContext = () => {
  const { ctx, session, answeredCallbacks } = createBaseContext();
  const taxiDraft = {
    stage: 'awaitingConfirmation' as const,
    pickup: buildLocation('Алматы, проспект Достык, 1'),
    dropoff: buildLocation('Алматы, улица Панфилова, 100'),
    price: buildPrice(),
    notes: 'Пассажир ожидает у входа',
    confirmationMessageId: 501,
    isPrivateHouse: true,
    recipientPhone: '+77005553322',
  };
  session.client.taxi = taxiDraft;
  return { ctx, draft: taxiDraft, answeredCallbacks };
};

const createDeliveryContext = () => {
  const { ctx, session, answeredCallbacks } = createBaseContext();
  const deliveryDraft = {
    stage: 'awaitingConfirmation' as const,
    pickup: buildLocation('Алматы, улица Абая, 90'),
    dropoff: buildLocation('Алматы, улица Гоголя, 15'),
    price: buildPrice(),
    notes: 'Позвонить перед приездом',
    confirmationMessageId: 601,
    isPrivateHouse: false,
    apartment: '12',
    entrance: '3',
    floor: '4',
    recipientPhone: '+77006664455',
  };
  session.client.delivery = deliveryDraft;
  return { ctx, draft: deliveryDraft, answeredCallbacks };
};

const buildTaxiOrder = (): OrderRecord => ({
  id: 321,
  shortId: 'T-321',
  kind: 'taxi',
  status: 'open',
  city: 'almaty',
  clientId: 2002,
  clientPhone: '+77001234567',
  customerName: 'Test User',
  customerUsername: 'customer',
  pickup: buildLocation('Алматы, проспект Достык, 1'),
  dropoff: buildLocation('Алматы, улица Панфилова, 100'),
  price: buildPrice(),
  createdAt: new Date(),
});

const buildDeliveryOrder = (): OrderRecord => ({
  id: 654,
  shortId: 'D-654',
  kind: 'delivery',
  status: 'open',
  city: 'almaty',
  clientId: 2002,
  clientPhone: '+77001234567',
  recipientPhone: '+77006664455',
  customerName: 'Test User',
  customerUsername: 'customer',
  clientComment: 'Позвонить перед приездом',
  apartment: '12',
  entrance: '3',
  floor: '4',
  isPrivateHouse: false,
  pickup: buildLocation('Алматы, улица Абая, 90'),
  dropoff: buildLocation('Алматы, улица Гоголя, 15'),
  price: buildPrice(),
  createdAt: new Date(),
});

describe('client order publish failures', () => {
  let registerTaxiOrderFlow: typeof import('../../src/bot/flows/client/taxiOrderFlow')['registerTaxiOrderFlow'];
  let registerDeliveryOrderFlow: typeof import('../../src/bot/flows/client/deliveryOrderFlow')['registerDeliveryOrderFlow'];
  let ordersDb: typeof import('../../src/db/orders');
  let ordersChannel: typeof import('../../src/bot/channels/ordersChannel');
  let reportsModule: typeof import('../../src/bot/services/reports');
  let uiModule: typeof import('../../src/bot/ui');
  let clientMenuModule: typeof import('../../src/ui/clientMenu');
  let cleanupModule: typeof import('../../src/bot/services/cleanup');

  before(async () => {
    ({ registerTaxiOrderFlow } = await import('../../src/bot/flows/client/taxiOrderFlow'));
    ({ registerDeliveryOrderFlow } = await import('../../src/bot/flows/client/deliveryOrderFlow'));
    ordersDb = await import('../../src/db/orders');
    ordersChannel = await import('../../src/bot/channels/ordersChannel');
    reportsModule = await import('../../src/bot/services/reports');
    uiModule = await import('../../src/bot/ui');
    clientMenuModule = await import('../../src/ui/clientMenu');
    cleanupModule = await import('../../src/bot/services/cleanup');
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('cancels taxi order and surfaces manual publish message when channel publish fails', async () => {
    const order = buildTaxiOrder();
    const createOrderMock = mock.method(ordersDb, 'createOrder', async () => order);
    const cancelOrderMock = mock.method(ordersDb, 'markOrderAsCancelled', async () => ({
      ...order,
      status: 'cancelled',
    }));
    const publishMock = mock.method(ordersChannel, 'publishOrderToDriversChannel', async () => {
      throw new Error('channel down');
    });
    const reportCalls: unknown[] = [];
    const reportMock = mock.method(
      reportsModule,
      'reportOrderCreated',
      async (_telegram: unknown, context: { order: OrderRecord; publishStatus: string }) => {
        reportCalls.push(context);
      },
    );
    const stepCalls: Array<{ id: string; text?: string }> = [];
    const stepMock = mock.method(uiModule.ui, 'step', async (_ctx: unknown, options: { id: string; text?: string }) => {
      stepCalls.push({ id: options.id, text: options.text });
      return { messageId: options.id === 'client:taxi:status' ? 11 : 12, sent: true };
    });
    const sendClientMenuMock = mock.method(clientMenuModule, 'sendClientMenu', async () => undefined);
    const clearKeyboardMock = mock.method(cleanupModule, 'clearInlineKeyboard', async () => true);

    const { bot, actions } = createBot();
    registerTaxiOrderFlow(bot);
    const handler = findActionHandler(actions, 'client:order:taxi:confirm');
    const { ctx, draft, answeredCallbacks } = createTaxiContext();

    await handler(ctx);

    assert.equal(createOrderMock.mock.callCount(), 1);
    assert.equal(publishMock.mock.callCount(), 1);
    assert.equal(cancelOrderMock.mock.callCount(), 1);
    assert.equal(reportMock.mock.callCount(), 1);
    const reportContext = reportCalls[0] as { publishStatus: string; order: OrderRecord };
    assert.equal(reportContext.publishStatus, 'publish_failed');
    assert.equal(reportContext.order.status, 'cancelled');
    const finalStep = stepCalls.find((call) => call.id === 'client:taxi:created');
    assert.ok(finalStep, 'expected taxi created step to be sent');
    assert.ok(finalStep?.text?.includes('не был отправлен'), 'customer message should mention publish failure');
    assert.ok(
      answeredCallbacks.some((entry) => entry.text?.includes('Заказ записан, оператор свяжется вручную.')),
      'should alert customer about manual handling',
    );
    assert.equal(draft.stage, 'idle');
    assert.equal(clearKeyboardMock.mock.callCount(), 1);
    assert.equal(sendClientMenuMock.mock.callCount(), 1);
  });

  it('cancels delivery order and informs staff when publish fails', async () => {
    const order = buildDeliveryOrder();
    const createOrderMock = mock.method(ordersDb, 'createOrder', async () => order);
    const cancelOrderMock = mock.method(ordersDb, 'markOrderAsCancelled', async () => ({
      ...order,
      status: 'cancelled',
    }));
    const publishMock = mock.method(ordersChannel, 'publishOrderToDriversChannel', async () => {
      throw new Error('channel down');
    });
    const reportCalls: unknown[] = [];
    const reportMock = mock.method(
      reportsModule,
      'reportOrderCreated',
      async (_telegram: unknown, context: { order: OrderRecord; publishStatus: string }) => {
        reportCalls.push(context);
      },
    );
    const stepCalls: Array<{ id: string; text?: string }> = [];
    mock.method(uiModule.ui, 'step', async (_ctx: unknown, options: { id: string; text?: string }) => {
      stepCalls.push({ id: options.id, text: options.text });
      return { messageId: options.id === 'client:delivery:status' ? 21 : 22, sent: true };
    });
    const sendClientMenuMock = mock.method(clientMenuModule, 'sendClientMenu', async () => undefined);
    const clearKeyboardMock = mock.method(cleanupModule, 'clearInlineKeyboard', async () => true);

    const { bot, actions } = createBot();
    registerDeliveryOrderFlow(bot);
    const handler = findActionHandler(actions, 'client:order:delivery:confirm');
    const { ctx, draft, answeredCallbacks } = createDeliveryContext();

    await handler(ctx);

    assert.equal(createOrderMock.mock.callCount(), 1);
    assert.equal(publishMock.mock.callCount(), 1);
    assert.equal(cancelOrderMock.mock.callCount(), 1);
    assert.equal(reportMock.mock.callCount(), 1);
    const reportContext = reportCalls[0] as { publishStatus: string; order: OrderRecord };
    assert.equal(reportContext.publishStatus, 'publish_failed');
    assert.equal(reportContext.order.status, 'cancelled');
    const finalStep = stepCalls.find((call) => call.id === 'client:delivery:created');
    assert.ok(finalStep, 'expected delivery created step to be sent');
    assert.ok(
      finalStep?.text?.includes('не был отправлен исполнителям'),
      'customer message should mention manual handling for delivery',
    );
    assert.ok(
      answeredCallbacks.some((entry) => entry.text?.includes('Заказ записан, оператор свяжется вручную.')),
      'should alert customer about manual handling',
    );
    assert.equal(draft.stage, 'idle');
    assert.equal(clearKeyboardMock.mock.callCount(), 1);
    assert.equal(sendClientMenuMock.mock.callCount(), 1);
  });
});
