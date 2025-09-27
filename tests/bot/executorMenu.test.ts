import '../helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';

import { EXECUTOR_VERIFICATION_PHOTO_COUNT, type BotContext, type SessionState } from '../../src/bot/types';
import type { UiStepOptions } from '../../src/bot/ui';

let showExecutorMenu: typeof import('../../src/bot/flows/executor/menu')['showExecutorMenu'];
let uiHelper: typeof import('../../src/bot/ui')['ui'];

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

  ({ showExecutorMenu } = await import('../../src/bot/flows/executor/menu'));
  ({ ui: uiHelper } = await import('../../src/bot/ui'));
});

const DEFAULT_CITY = 'almaty' as const;

type ChatType = NonNullable<BotContext['chat']>['type'];

const createSessionState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: true,
  awaitingPhone: false,
  phoneNumber: undefined,
  user: undefined,
  city: DEFAULT_CITY,
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
    telegramId: 123,
    phoneVerified: false,
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

const createContext = (type: ChatType) => {
  const session = createSessionState();
  const auth = createAuthState();

  const ctx = {
    chat: { id: 99, type, title: 'Test chat' },
    from: { id: auth.user.telegramId, is_bot: false, first_name: 'Tester' },
    session,
    auth,
    answerCbQuery: async () => true,
    deleteMessage: async () => true,
    editMessageReplyMarkup: async () => true,
    reply: async (text: string) => ({
      message_id: 1,
      chat: { id: 99, type, title: 'Test chat' },
      date: Math.floor(Date.now() / 1000),
      text,
    }),
    telegram: {
      editMessageText: async () => true,
      deleteMessage: async () => true,
      sendMessage: async (chatId: number, text: string) => ({
        message_id: 1,
        chat: { id: chatId, type, title: 'Test chat' },
        date: Math.floor(Date.now() / 1000),
        text,
      }),
    },
    update: {} as never,
    updateType: 'callback_query',
    botInfo: {} as never,
    state: {},
  };

  return ctx as unknown as BotContext;
};

let originalStep: typeof uiHelper.step;
let recordedSteps: UiStepOptions[];

beforeEach(() => {
  recordedSteps = [];
  originalStep = uiHelper.step;
  (uiHelper as { step: typeof uiHelper.step }).step = async (_ctx, options) => {
    recordedSteps.push(options);
    return { messageId: recordedSteps.length, sent: true };
  };
});

afterEach(() => {
  (uiHelper as { step: typeof uiHelper.step }).step = originalStep;
});

describe('executor menu visibility', () => {
  it('does not render the menu for non-private chats', async () => {
    const ctx = createContext('supergroup');

    await showExecutorMenu(ctx);

    assert.equal(recordedSteps.length, 0);
    assert.equal(ctx.session.ui.pendingCityAction, undefined);
  });
});
