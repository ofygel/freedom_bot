import './helpers/setup-env';

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { pool } from '../src/db';
import {
  encodeRecentLocationId,
  findRecentLocation,
  loadRecentLocations,
  rememberLocation,
} from '../src/bot/services/recentLocations';
import {
  START_DELIVERY_ORDER_ACTION,
  registerDeliveryOrderFlow,
} from '../src/bot/flows/client/deliveryOrderFlow';
import {
  START_TAXI_ORDER_ACTION,
  registerTaxiOrderFlow,
} from '../src/bot/flows/client/taxiOrderFlow';
import type { BotContext, ClientOrderDraftState } from '../src/bot/types';

const TEST_ERROR = new Error('Test database failure');

const originalQuery = pool.query;

const stubPoolQuery = () => {
  Reflect.set(pool, 'query', async () => {
    throw TEST_ERROR;
  });
};

const restorePoolQuery = () => {
  Reflect.set(pool, 'query', originalQuery);
};

type ActionHandler = (ctx: BotContext) => Promise<void>;

type MockActionEntry = { trigger: string | RegExp; handler: ActionHandler };

const createMockBot = () => {
  const actions: MockActionEntry[] = [];
  const bot = {
    action(trigger: string | RegExp, handler: ActionHandler) {
      actions.push({ trigger, handler });
      return bot;
    },
    hears() {
      return bot;
    },
    command() {
      return bot;
    },
    on() {
      return bot;
    },
  } as unknown as import('telegraf').Telegraf<BotContext> & {
    action(trigger: string | RegExp, handler: ActionHandler): typeof bot;
  };

  return { bot, actions };
};

const findActionHandler = (actions: MockActionEntry[], trigger: string): ActionHandler => {
  const entry = actions.find((item) => item.trigger === trigger);
  if (!entry) {
    throw new Error(`Handler for ${trigger} was not registered`);
  }
  return entry.handler;
};

const findRegexActionHandler = (actions: MockActionEntry[], pattern: RegExp): ActionHandler => {
  const entry = actions.find(
    (item) => item.trigger instanceof RegExp && item.trigger.source === pattern.source,
  );
  if (!entry) {
    throw new Error(`Handler for ${pattern} was not registered`);
  }
  return entry.handler;
};

const createClientSessionState = () => ({
  ephemeralMessages: [],
  isAuthenticated: true,
  awaitingPhone: false,
  city: 'almaty' as const,
  executor: {
    role: 'courier' as const,
    verification: {
      courier: { status: 'idle' as const, requiredPhotos: 2, uploadedPhotos: [] },
      driver: { status: 'idle' as const, requiredPhotos: 2, uploadedPhotos: [] },
    },
    subscription: { status: 'idle' as const },
  },
  client: {
    taxi: { stage: 'idle' as ClientOrderDraftState['stage'] },
    delivery: { stage: 'idle' as ClientOrderDraftState['stage'] },
  },
  ui: { steps: {}, homeActions: [] as string[] },
  support: { status: 'idle' as const },
});

const createClientContext = () => {
  const session = createClientSessionState();
  const replyMessages: string[] = [];
  const answeredCallbacks: string[] = [];
  const ctx = {
    chat: { id: 5001, type: 'private' as const },
    session,
    auth: {
      user: {
        telegramId: 3001,
        username: undefined,
        firstName: 'Client',
        lastName: undefined,
        phone: undefined,
        phoneVerified: false,
        role: 'client' as const,
        status: 'active_client' as const,
        isVerified: false,
        isBlocked: false,
      },
      executor: {
        verifiedRoles: { courier: false, driver: false },
        hasActiveSubscription: false,
        isVerified: false,
      },
      isModerator: false,
    },
    reply: async (text: string) => {
      replyMessages.push(text);
      return { message_id: replyMessages.length, chat: { id: 5001 }, text };
    },
    telegram: {
      sendMessage: async (chatId: number, text: string) => {
        replyMessages.push(text);
        return { message_id: replyMessages.length, chat: { id: chatId }, text };
      },
      deleteMessage: async () => {},
      editMessageText: async () => {},
    },
    answerCbQuery: async (text?: string) => {
      if (text) {
        answeredCallbacks.push(text);
      }
    },
  } as unknown as BotContext & {
    answerCbQuery: (text?: string) => Promise<void>;
    reply: (text: string) => Promise<{ message_id: number }>;
  };

  return { ctx, session, replyMessages, answeredCallbacks };
};

describe('recentLocations service fallbacks', () => {
  beforeEach(() => {
    restorePoolQuery();
  });

  afterEach(() => {
    restorePoolQuery();
  });

  it('rememberLocation resolves even if pool.query fails', async () => {
    stubPoolQuery();

    await rememberLocation(101, 'almaty', 'pickup', {
      query: 'Test point',
      address: 'Test address',
      latitude: 43.238949,
      longitude: 76.889709,
    });
  });

  it('loadRecentLocations returns empty array on failure', async () => {
    stubPoolQuery();

    const result = await loadRecentLocations(102, 'almaty', 'pickup');
    assert.deepEqual(result, []);
  });

  it('findRecentLocation returns null on failure', async () => {
    stubPoolQuery();

    const result = await findRecentLocation(103, 'almaty', 'pickup', 'deadbeef');
    assert.equal(result, null);
  });
});

describe('client flows continue when recent locations fail', () => {
  afterEach(() => {
    restorePoolQuery();
  });

  it('delivery order start proceeds without recent locations', async () => {
    stubPoolQuery();

    const { bot, actions } = createMockBot();
    registerDeliveryOrderFlow(bot);
    const startHandler = findActionHandler(actions, START_DELIVERY_ORDER_ACTION);

    const { ctx, session, replyMessages } = createClientContext();
    await startHandler(ctx);

    assert.equal(session.client.delivery.stage, 'collectingPickup');
    assert.ok(replyMessages.length > 0);
  });

  it('taxi order start proceeds without recent locations', async () => {
    stubPoolQuery();

    const { bot, actions } = createMockBot();
    registerTaxiOrderFlow(bot);
    const startHandler = findActionHandler(actions, START_TAXI_ORDER_ACTION);

    const { ctx, session, replyMessages } = createClientContext();
    await startHandler(ctx);

    assert.equal(session.client.taxi.stage, 'collectingPickup');
    assert.ok(replyMessages.length > 0);
  });

  it('delivery recent pickup fallback answers with default hint', async () => {
    stubPoolQuery();

    const { bot, actions } = createMockBot();
    registerDeliveryOrderFlow(bot);

    const recentPickupHandler = findRegexActionHandler(
      actions,
      /^client:order:delivery:recent:pickup:([A-Za-z0-9_-]+)/,
    );

    const { ctx, session, answeredCallbacks } = createClientContext();
    session.client.delivery.stage = 'collectingPickup';
    const rawLocationId = 'deadbeef'.repeat(5);
    const encodedLocationId = encodeRecentLocationId(rawLocationId);
    if (!encodedLocationId) {
      throw new Error('Failed to encode test location id');
    }
    (ctx as any).callbackQuery = {
      id: 'callback',
      data: `client:order:delivery:recent:pickup:${encodedLocationId}`,
    };
    (ctx as any).match = [
      `client:order:delivery:recent:pickup:${encodedLocationId}`,
      encodedLocationId,
    ];

    await recentPickupHandler(ctx);

    assert.equal(session.client.delivery.stage, 'collectingPickup');
    assert.ok(answeredCallbacks.some((text) => text.includes('Кнопка устарела')));
  });
});

