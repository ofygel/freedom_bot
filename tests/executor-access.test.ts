import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';

import { EXECUTOR_VERIFICATION_PHOTO_COUNT, type BotContext, type SessionState } from '../src/bot/types';
import type { InlineKeyboardMarkup, ReplyKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import type { UiStepOptions } from '../src/bot/ui';

let ensureExecutorState: typeof import('../src/bot/flows/executor/menu')['ensureExecutorState'];
let showExecutorMenu: typeof import('../src/bot/flows/executor/menu')['showExecutorMenu'];
let EXECUTOR_SUBSCRIPTION_ACTION: typeof import('../src/bot/flows/executor/menu')['EXECUTOR_SUBSCRIPTION_ACTION'];
let EXECUTOR_ORDERS_ACTION: typeof import('../src/bot/flows/executor/menu')['EXECUTOR_ORDERS_ACTION'];
let EXECUTOR_SUPPORT_ACTION: typeof import('../src/bot/flows/executor/menu')['EXECUTOR_SUPPORT_ACTION'];
let EXECUTOR_MENU_ACTION: typeof import('../src/bot/flows/executor/menu')['EXECUTOR_MENU_ACTION'];
let EXECUTOR_MENU_TEXT_LABELS: typeof import('../src/bot/flows/executor/menu')['EXECUTOR_MENU_TEXT_LABELS'];
let startExecutorSubscription: typeof import('../src/bot/flows/executor/subscription')['startExecutorSubscription'];
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

  ({
    ensureExecutorState,
    showExecutorMenu,
    EXECUTOR_SUBSCRIPTION_ACTION,
    EXECUTOR_ORDERS_ACTION,
    EXECUTOR_SUPPORT_ACTION,
    EXECUTOR_MENU_ACTION,
    EXECUTOR_MENU_TEXT_LABELS,
  } = await import('../src/bot/flows/executor/menu'));
  ({ startExecutorSubscription } = await import('../src/bot/flows/executor/subscription'));
  ({ ui: uiHelper } = await import('../src/bot/ui'));
});

const DEFAULT_CITY = 'almaty' as const;

const createSessionState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
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
  ui: { steps: {}, homeActions: [], pendingCityAction: undefined },
  support: { status: 'idle' },
});

const createAuthState = (telegramId = 700): BotContext['auth'] => ({
  user: {
    telegramId,
    username: undefined,
    firstName: undefined,
    lastName: undefined,
    phone: undefined,
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

const createContext = () => {
  const session = createSessionState();
  const auth = createAuthState();

  const ctx = {
    chat: { id: 700, type: 'private' as const },
    from: { id: auth.user.telegramId },
    session,
    auth,
    answerCbQuery: async () => {},
    reply: async () => ({ message_id: 1, chat: { id: 700 }, text: '' }),
    telegram: {
      editMessageText: async () => true,
      deleteMessage: async () => true,
      copyMessage: async () => true,
    },
  } as unknown as BotContext;

  return { ctx, session, auth };
};

const mapKeyboard = (
  keyboard: InlineKeyboardMarkup | ReplyKeyboardMarkup | undefined,
): { text: string; callback_data?: string }[][] => {
  if (!keyboard || !('inline_keyboard' in keyboard)) {
    return [];
  }

  return keyboard.inline_keyboard.map((row) =>
    row.map((button) => ({
      text: button.text,
      callback_data:
        'callback_data' in button && typeof button.callback_data === 'string'
          ? button.callback_data
          : undefined,
    })),
  );
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

describe('executor access control', () => {
  it('prompts to select a city before showing the executor menu', async () => {
    const { ctx } = createContext();
    ctx.session.city = undefined;
    ctx.auth.user.citySelected = undefined;

    const replies: string[] = [];
    (ctx as { reply: BotContext['reply'] }).reply = (async (text: string) => {
      replies.push(text);
      return {
        message_id: replies.length,
        chat: { id: ctx.chat!.id },
        text,
      };
    }) as BotContext['reply'];

    await showExecutorMenu(ctx);

    assert.equal(ctx.session.ui.pendingCityAction, 'executorMenu');
    assert.deepEqual(replies, ['Выберите город, чтобы получить доступ к заказам.']);
    assert.equal(recordedSteps.length, 0);

    ctx.auth.user.citySelected = DEFAULT_CITY;
    ctx.session.city = DEFAULT_CITY;

    await showExecutorMenu(ctx);

    const menuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');
    assert.ok(menuStep, 'executor menu should be displayed after selecting a city');
    assert.equal(ctx.session.ui.pendingCityAction, undefined);
  });

  it('blocks subscription start when verification is missing', async () => {
    const { ctx } = createContext();
    ensureExecutorState(ctx);

    await startExecutorSubscription(ctx);

    const state = ctx.session.executor.subscription;
    assert.equal(state.status, 'idle');
    assert.equal(state.selectedPeriodId, undefined);
    const rejection = recordedSteps.find(
      (step) => step.id === 'executor:subscription:verification-required',
    );
    assert.ok(rejection, 'verification reminder should be shown');
    assert.equal(
      rejection.text,
      'Вы пока не прошли модерацию. Отправьте фото удостоверения личности с обеих сторон в этот чат, чтобы мы выдали доступ.',
    );
  });

  it('highlights driver-specific verification requirements before subscription', async () => {
    const { ctx, session, auth } = createContext();
    session.executor.role = 'driver';
    auth.user.role = 'driver';
    ensureExecutorState(ctx);

    await startExecutorSubscription(ctx);

    const rejection = recordedSteps.find(
      (step) => step.id === 'executor:subscription:verification-required',
    );
    assert.ok(rejection, 'verification reminder should be shown');
    assert.equal(
      rejection?.text,
      'Вы пока не прошли модерацию. Отправьте фото водительского удостоверения (лицевая сторона) и селфи с ним в этот чат, чтобы мы выдали доступ.',
    );
  });

  it('shows the default executor menu keyboard when access requirements are not met', async () => {
    const { ctx } = createContext();
    ensureExecutorState(ctx);

    await showExecutorMenu(ctx, { skipAccessCheck: true });

    const menuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');
    assert.ok(menuStep, 'executor menu should be displayed');

    assert.deepEqual(mapKeyboard(menuStep.keyboard), [
      [
        {
          text: '📨 Получить ссылку на канал',
          callback_data: EXECUTOR_SUBSCRIPTION_ACTION,
        },
      ],
      [
        {
          text: '🔄 Обновить меню',
          callback_data: EXECUTOR_MENU_ACTION,
        },
      ],
    ]);
  });

  it('highlights verification progress while collecting photos', async () => {
    const { ctx } = createContext();
    ensureExecutorState(ctx);

    ctx.session.executor.verification.courier.status = 'collecting';
    ctx.session.executor.verification.courier.uploadedPhotos.push({
      fileId: 'photo-1',
      messageId: 101,
    });

    await showExecutorMenu(ctx, { skipAccessCheck: true });

    const menuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');
    assert.ok(menuStep, 'executor menu should be displayed');

    assert.deepEqual(mapKeyboard(menuStep.keyboard), [
      [
        {
          text: '📨 Получить ссылку на канал',
          callback_data: EXECUTOR_SUBSCRIPTION_ACTION,
        },
      ],
      [
        {
          text: '🔄 Обновить меню',
          callback_data: EXECUTOR_MENU_ACTION,
        },
      ],
    ]);
  });

  it('renders the executor menu when verification and subscription are active', async () => {
    const { ctx } = createContext();
    ensureExecutorState(ctx);

    ctx.auth.executor.verifiedRoles.courier = true;
    ctx.auth.executor.isVerified = true;
    ctx.auth.executor.hasActiveSubscription = true;
    ctx.auth.user.isVerified = true;

    await showExecutorMenu(ctx);

    const menuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');
    assert.ok(menuStep, 'executor menu should be displayed');

    assert.deepEqual(mapKeyboard(menuStep.keyboard), [
      [
        {
          text: 'Заказы',
          callback_data: EXECUTOR_ORDERS_ACTION,
        },
      ],
      [
        {
          text: 'Связаться с поддержкой',
          callback_data: EXECUTOR_SUPPORT_ACTION,
        },
      ],
    ]);
  });
});

describe('executor menu formatting', () => {
  it('omits cached invite link when subscription becomes inactive', async () => {
    const { ctx } = createContext();
    ensureExecutorState(ctx);

    ctx.auth.executor.verifiedRoles.courier = true;
    ctx.auth.executor.isVerified = true;
    ctx.auth.user.isVerified = true;

    ctx.session.executor.subscription.lastInviteLink = 'https://t.me/+cached-invite';
    ctx.session.executor.subscription.lastIssuedAt = 1_700_000_000_000;

    await showExecutorMenu(ctx, { skipAccessCheck: true });

    const subscription = ctx.session.executor.subscription;
    assert.strictEqual(subscription.lastInviteLink, undefined);
    assert.strictEqual(subscription.lastIssuedAt, undefined);

    const menuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');
    assert.ok(menuStep, 'executor menu should be displayed');

    assert.ok(
      menuStep.text?.includes(
        'Получите ссылку на канал курьеров: после подтверждения документов мы выдадим 2-дневный пробный доступ',
      ),
      'menu should prompt to request a new link and explain the trial access',
    );
    assert.ok(
      !menuStep.text?.includes('Ссылка на канал уже выдана'),
      'menu should not mention previously issued link when subscription is inactive',
    );

    assert.ok(
      menuStep.text?.includes('👉 Что дальше:'),
      'menu should explain the next steps for исполнителя',
    );
  });
});
