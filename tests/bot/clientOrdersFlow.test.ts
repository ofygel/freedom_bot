import '../helpers/setup-env';

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { mock } from 'node:test';
import type { Telegraf } from 'telegraf';

import type { BotContext } from '../../src/bot/types';
import { copy } from '../../src/bot/copy';
import {
  CLIENT_CONFIRM_CANCEL_ORDER_ACTION_PATTERN,
  CLIENT_ORDERS_ACTION,
  CLIENT_VIEW_ORDER_ACTION_PATTERN,
} from '../../src/bot/flows/client/orderActions';

type ActionHandler = (ctx: BotContext & { match?: RegExpExecArray }) => Promise<void>;

let registerClientOrdersFlow: typeof import('../../src/bot/flows/client/orders')['registerClientOrdersFlow'];
let ordersDb: typeof import('../../src/db/orders');
let uiModule: typeof import('../../src/bot/ui');
let feedbackModule: typeof import('../../src/bot/services/feedback');

before(async () => {
  ({ registerClientOrdersFlow } = await import('../../src/bot/flows/client/orders'));
  ordersDb = await import('../../src/db/orders');
  uiModule = await import('../../src/bot/ui');
  feedbackModule = await import('../../src/bot/services/feedback');
});

const createBot = () => {
  const actions: Array<{ pattern: string | RegExp; handler: ActionHandler }> = [];

  const bot = {
    action: (pattern: string | RegExp, handler: ActionHandler) => {
      actions.push({ pattern, handler });
      return bot;
    },
    hears: () => bot,
    command: () => bot,
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

const createContext = () => {
  const replies: string[] = [];
  const callbackAnswers: Array<{ text?: string; options?: unknown }> = [];

  const ctx = {
    chat: { id: 1001, type: 'private' as const, title: 'Test chat' },
    callbackQuery: { id: 'test-cb', message: { chat: { id: 1001, type: 'private' as const } } } as never,
    from: { id: 2002, is_bot: false, first_name: 'Tester' },
    session: {
      ephemeralMessages: [],
      isAuthenticated: true,
      awaitingPhone: false,
      executor: {
        role: 'courier' as const,
        verification: {
          courier: { status: 'idle' as const, requiredPhotos: 0, uploadedPhotos: [] },
          driver: { status: 'idle' as const, requiredPhotos: 0, uploadedPhotos: [] },
        },
        subscription: { status: 'idle' as const },
      },
      client: {
        taxi: { stage: 'idle' as const },
        delivery: { stage: 'idle' as const },
      },
      ui: { steps: {}, homeActions: [] },
      support: { status: 'idle' as const },
    },
    auth: {
      user: {
        telegramId: 2002,
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
    answerCbQuery: async (text?: string, options?: unknown) => {
      callbackAnswers.push({ text, options });
      return true;
    },
    reply: async (text: string) => {
      replies.push(text);
      return {
        message_id: replies.length,
        chat: { id: 1001, type: 'private' as const },
        date: Math.floor(Date.now() / 1000),
        text,
      };
    },
    telegram: {
      sendChatAction: async () => undefined,
      deleteMessage: async () => true,
    },
    update: {} as never,
    updateType: 'callback_query' as const,
    botInfo: {} as never,
    state: {},
  } as unknown as BotContext & { match?: RegExpExecArray } & {
    answerCbQuery: (text?: string, options?: unknown) => Promise<true>;
    reply: (text: string) => Promise<{ text: string }>;
  };

  return { ctx, replies, callbackAnswers };
};

describe('client orders flow failures', () => {
  it('answers with service unavailable when order listing fails', async () => {
    const listMock = mock.method(ordersDb, 'listClientOrders', async () => {
      throw new Error('db down');
    });
    const clearMock = mock.method(uiModule.ui, 'clear', async () => undefined);
    const stepMock = mock.method(uiModule.ui, 'step', async () => ({ messageId: 1, sent: true }));

    const { bot, actions } = createBot();
    registerClientOrdersFlow(bot);

    const handler = findActionHandler(actions, CLIENT_ORDERS_ACTION);
    const { ctx, replies, callbackAnswers } = createContext();

    try {
      await handler(ctx);

      assert.equal(listMock.mock.callCount(), 1);
      assert.equal(stepMock.mock.callCount(), 0);
      assert.equal(clearMock.mock.callCount(), 1);
      assert.deepEqual(replies, [copy.serviceUnavailable]);
      const lastAnswer = callbackAnswers.at(-1);
      assert.deepEqual(lastAnswer, { text: copy.serviceUnavailable, options: { show_alert: true } });
    } finally {
      listMock.mock.restore();
      clearMock.mock.restore();
      stepMock.mock.restore();
    }
  });

  it('answers with service unavailable when order detail load fails', async () => {
    const getOrderMock = mock.method(ordersDb, 'getOrderWithExecutorById', async () => {
      throw new Error('db down');
    });
    const clearMock = mock.method(uiModule.ui, 'clear', async () => undefined);
    const stepMock = mock.method(uiModule.ui, 'step', async () => ({ messageId: 1, sent: true }));

    const { bot, actions } = createBot();
    registerClientOrdersFlow(bot);

    const handler = findActionHandler(actions, CLIENT_VIEW_ORDER_ACTION_PATTERN);
    const { ctx, replies, callbackAnswers } = createContext();
    ctx.match = Object.assign(['client:orders:view:42', '42'], {
      index: 0,
      input: 'client:orders:view:42',
      groups: undefined,
    }) as RegExpExecArray;

    try {
      await handler(ctx);

      assert.equal(getOrderMock.mock.callCount(), 1);
      assert.equal(stepMock.mock.callCount(), 0);
      assert.equal(clearMock.mock.callCount(), 1);
      assert.deepEqual(replies, [copy.serviceUnavailable]);
      const lastAnswer = callbackAnswers.at(-1);
      assert.deepEqual(lastAnswer, { text: copy.serviceUnavailable, options: { show_alert: true } });
    } finally {
      getOrderMock.mock.restore();
      clearMock.mock.restore();
      stepMock.mock.restore();
    }
  });

  it('answers with service unavailable when order cancellation fails', async () => {
    const cancelMock = mock.method(ordersDb, 'cancelClientOrder', async () => {
      throw new Error('db down');
    });
    const feedbackMock = mock.method(feedbackModule, 'sendProcessingFeedback', async () => undefined);
    const clearMock = mock.method(uiModule.ui, 'clear', async () => undefined);
    const stepMock = mock.method(uiModule.ui, 'step', async () => ({ messageId: 1, sent: true }));

    const { bot, actions } = createBot();
    registerClientOrdersFlow(bot);

    const handler = findActionHandler(actions, CLIENT_CONFIRM_CANCEL_ORDER_ACTION_PATTERN);
    const { ctx, replies, callbackAnswers } = createContext();
    ctx.match = Object.assign(['client:orders:cancel-confirm:7', '7'], {
      index: 0,
      input: 'client:orders:cancel-confirm:7',
      groups: undefined,
    }) as RegExpExecArray;

    try {
      await handler(ctx);

      assert.equal(cancelMock.mock.callCount(), 1);
      assert.equal(feedbackMock.mock.callCount(), 1);
      assert.equal(stepMock.mock.callCount(), 0);
      assert.equal(clearMock.mock.callCount(), 1);
      assert.deepEqual(replies, [copy.serviceUnavailable]);
      const lastAnswer = callbackAnswers.at(-1);
      assert.deepEqual(lastAnswer, { text: copy.serviceUnavailable, options: { show_alert: true } });
    } finally {
      cancelMock.mock.restore();
      feedbackMock.mock.restore();
      clearMock.mock.restore();
      stepMock.mock.restore();
    }
  });
});

