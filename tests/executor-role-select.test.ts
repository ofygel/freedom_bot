import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import type { Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup, ReplyKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

import {
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type BotContext,
  type SessionState,
} from '../src/bot/types';
import type { UiStepOptions } from '../src/bot/ui';

let registerExecutorRoleSelect: typeof import('../src/bot/flows/executor/roleSelect')['registerExecutorRoleSelect'];
let commandsService: typeof import('../src/bot/services/commands');
let uiHelper: typeof import('../src/bot/ui')['ui'];

before(async () => {
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

  ({ registerExecutorRoleSelect } = await import('../src/bot/flows/executor/roleSelect'));
  commandsService = await import('../src/bot/services/commands');
  ({ ui: uiHelper } = await import('../src/bot/ui'));
});

const ROLE_DRIVER_ACTION = 'role:driver';

const DEFAULT_CITY = 'almaty' as const;

const createSessionState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
  city: DEFAULT_CITY,
  executor: {
    role: 'courier',
    verification: {
      courier: {
        status: 'idle',
        requiredPhotos: EXECUTOR_VERIFICATION_PHOTO_COUNT,
        uploadedPhotos: [],
      },
      driver: {
        status: 'idle',
        requiredPhotos: EXECUTOR_VERIFICATION_PHOTO_COUNT,
        uploadedPhotos: [],
      },
    },
    subscription: { status: 'idle' },
  },
  client: {
    taxi: { stage: 'idle' },
    delivery: { stage: 'idle' },
  },
  ui: { steps: {}, homeActions: [] },
  support: { status: 'idle' },
});

const createAuthState = (): BotContext['auth'] => ({
  user: {
    telegramId: 99,
    username: undefined,
    firstName: undefined,
    lastName: undefined,
    phone: undefined,
    role: 'courier',
    status: 'active_executor',
    isVerified: false,
    isBlocked: false,
    citySelected: DEFAULT_CITY,
  },
  executor: {
    verifiedRoles: { courier: false, driver: false },
    hasActiveSubscription: false,
    isVerified: false,
  },
  isModerator: false,
});

const createMockBot = () => {
  const actions = new Map<string, (ctx: BotContext) => Promise<void>>();

  const bot: Partial<Telegraf<BotContext>> = {
    telegram: {
      setMyCommands: async () => undefined,
      setChatMenuButton: async () => undefined,
    } as unknown as Telegraf<BotContext>['telegram'],
  };

  bot.action = (trigger: string, handler: (ctx: BotContext) => Promise<void>) => {
    actions.set(trigger, handler);
    return bot as Telegraf<BotContext>;
  };

  return {
    bot: bot as Telegraf<BotContext>,
    getAction: (trigger: string) => actions.get(trigger),
  };
};

const createMockContext = () => {
  const session = createSessionState();
  const auth = createAuthState();
  let nextMessageId = 1;
  let callbackRemoved = false;

  const sendMessageCalls: Array<{
    chatId: number;
    text: string;
    extra?: unknown;
    messageId: number;
  }> = [];

  const ctx = {
    chat: { id: 99, type: 'private' as const },
    from: { id: 99 },
    session,
    auth,
    answerCbQuery: async () => undefined,
    deleteMessage: async () => {
      callbackRemoved = true;
      return true;
    },
    editMessageReplyMarkup: async () => undefined,
    reply: async (text: string, extra?: unknown) => {
      if (callbackRemoved) {
        const error = new Error('Bad Request: message to reply not found');
        (error as { description?: string }).description =
          'Bad Request: message to reply not found';
        throw error;
      }

      const messageId = nextMessageId++;
      return { message_id: messageId, chat: { id: 99 }, text };
    },
    telegram: {
      editMessageText: async (
        chatId: number,
        messageId: number,
        _inlineId: undefined,
        text: string,
        extra?: unknown,
      ) => true,
      deleteMessage: async () => true,
      sendMessage: async (chatId: number, text: string, extra?: unknown) => {
        const messageId = nextMessageId++;
        sendMessageCalls.push({ chatId, text, extra, messageId });
        return { message_id: messageId, chat: { id: chatId }, text };
      },
      setMyCommands: async () => undefined,
      setChatMenuButton: async () => undefined,
    },
  } as unknown as BotContext;

  return {
    ctx,
    session,
    auth,
    sendMessageCalls,
  };
};

let originalStep: typeof uiHelper.step;
let recordedSteps: UiStepOptions[];

beforeEach(() => {
  recordedSteps = [];
  originalStep = uiHelper.step;
  (uiHelper as { step: typeof uiHelper.step }).step = async (ctx, options) => {
    recordedSteps.push(options);
    return originalStep(ctx, options);
  };
});

afterEach(() => {
  (uiHelper as { step: typeof uiHelper.step }).step = originalStep;
});

describe('executor role selection', () => {
  it('renders the executor menu when switching to driver after removing the callback message', async () => {
    const setChatCommandsMock = mock.method(
      commandsService,
      'setChatCommands',
      async () => undefined,
    );

    const { bot, getAction } = createMockBot();
    registerExecutorRoleSelect(bot);

    const handler = getAction(ROLE_DRIVER_ACTION);
    assert.ok(handler, 'driver role action should be registered');

    const { ctx, sendMessageCalls } = createMockContext();

    try {
      await handler(ctx);
    } finally {
      setChatCommandsMock.mock.restore();
    }

    const menuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');
    assert.ok(menuStep, 'executor menu step should be displayed');
    assert.equal(ctx.auth.user.role, 'driver');
    assert.ok(sendMessageCalls.length >= 1);
    const fallbackCall = sendMessageCalls.at(-1);
    assert.ok(fallbackCall, 'fallback sendMessage should be recorded');
    assert.equal(fallbackCall.chatId, ctx.chat!.id);
    const fallbackMarkup = (fallbackCall.extra as {
      reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup;
    }).reply_markup;
    assert.ok(fallbackMarkup);
    assert.match(fallbackCall.text, /Меню водителя/);
  });
});
