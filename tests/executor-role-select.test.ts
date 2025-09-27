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
let ensureExecutorState: typeof import('../src/bot/flows/executor/menu')['ensureExecutorState'];
let registerExecutorMenu: typeof import('../src/bot/flows/executor/menu')['registerExecutorMenu'];
let EXECUTOR_MENU_CITY_ACTION: typeof import('../src/bot/flows/executor/menu')['EXECUTOR_MENU_CITY_ACTION'];
let registerExecutorVerification: typeof import('../src/bot/flows/executor/verification')['registerExecutorVerification'];
let registerCityAction: typeof import('../src/bot/flows/common/citySelect')['registerCityAction'];
let CITY_ACTION_PATTERN: typeof import('../src/bot/flows/common/citySelect')['CITY_ACTION_PATTERN'];
let commandsService: typeof import('../src/bot/services/commands');
let uiHelper: typeof import('../src/bot/ui')['ui'];
let usersDb: typeof import('../src/db/users');
let usersService: typeof import('../src/services/users');

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
  ({ ensureExecutorState, registerExecutorMenu, EXECUTOR_MENU_CITY_ACTION } = await import(
    '../src/bot/flows/executor/menu'
  ));
  ({ registerExecutorVerification } = await import('../src/bot/flows/executor/verification'));
  ({ registerCityAction, CITY_ACTION_PATTERN } = await import('../src/bot/flows/common/citySelect'));
  commandsService = await import('../src/bot/services/commands');
  ({ ui: uiHelper } = await import('../src/bot/ui'));
  usersDb = await import('../src/db/users');
  usersService = await import('../src/services/users');
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

const createMockBot = () => {
  const actions: Array<{
    trigger: string | RegExp;
    handler: (ctx: BotContext, next: () => Promise<void>) => Promise<void>;
  }> = [];

  const bot: Partial<Telegraf<BotContext>> = {
    telegram: {
      setMyCommands: async () => undefined,
      setChatMenuButton: async () => undefined,
    } as unknown as Telegraf<BotContext>['telegram'],
  };

  bot.action = (
    trigger: string | RegExp,
    handler: (ctx: BotContext, next: () => Promise<void>) => Promise<void>,
  ) => {
    actions.push({ trigger, handler });
    return bot as Telegraf<BotContext>;
  };

  bot.command = () => bot as Telegraf<BotContext>;
  bot.hears = () => bot as Telegraf<BotContext>;
  bot.on = () => bot as Telegraf<BotContext>;

  const getAction = (trigger: string) => {
    const entry = actions.find((candidate) => candidate.trigger === trigger);
    if (!entry) {
      return undefined;
    }

    return async (ctx: BotContext, next?: () => Promise<void>): Promise<void> => {
      await entry.handler(
        ctx,
        next ?? (async () => {
          /* noop */
        }),
      );
    };
  };

  const dispatchAction = async (data: string, ctx: BotContext): Promise<void> => {
    const matches = actions
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) =>
        typeof entry.trigger === 'string' ? entry.trigger === data : entry.trigger.test(data),
      );

    const mutableCtx = ctx as BotContext & { match?: RegExpExecArray | undefined };

    const run = async (position: number): Promise<void> => {
      const match = matches[position];
      if (!match) {
        return;
      }

      const {
        entry: { trigger, handler },
      } = match;

      if (trigger instanceof RegExp) {
        mutableCtx.match = trigger.exec(data) ?? undefined;
      } else {
        mutableCtx.match = undefined;
      }

      await handler(ctx, () => run(position + 1));
    };

    await run(0);
  };

  return {
    bot: bot as Telegraf<BotContext>,
    getAction,
    dispatchAction,
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
    editMessageText: async () => {
      throw new Error('message to edit not found');
    },
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
    update: {} as never,
    updateType: 'callback_query',
    botInfo: {} as never,
    state: {},
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
    assert.equal(menuStep, undefined, 'executor menu should wait until city is selected');
    assert.equal(ctx.session.ui.pendingCityAction, 'executorMenu');
    assert.equal(ctx.auth.user.role, 'driver');
    assert.ok(sendMessageCalls.length >= 1);
    const promptCall = sendMessageCalls.at(-1);
    assert.ok(promptCall, 'city selection prompt should be sent');
    assert.equal(promptCall.chatId, ctx.chat!.id);
    const promptMarkup = (promptCall.extra as {
      reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup;
    }).reply_markup;
    assert.ok(promptMarkup, 'city selection keyboard should be attached');
    assert.match(promptCall.text, /Сначала выбери город/);
  });

  it('shows the executor menu after city callback when another middleware stores the city', async () => {
    const setUserCitySelectedMock = mock.method(
      usersService,
      'setUserCitySelected',
      async () => undefined,
    );

    const { bot, dispatchAction } = createMockBot();
    registerExecutorMenu(bot);

    let cityMiddlewareExecuted = false;
    bot.action(CITY_ACTION_PATTERN, async (ctx) => {
      cityMiddlewareExecuted = true;
      ctx.session.city = DEFAULT_CITY;
      ctx.auth.user.citySelected = DEFAULT_CITY;
    });

    registerCityAction(bot);

    const { ctx } = createMockContext();
    ctx.session.city = undefined;
    ctx.auth.user.citySelected = undefined;
    ctx.session.ui.pendingCityAction = EXECUTOR_MENU_CITY_ACTION;

    Object.assign(ctx as BotContext & { callbackQuery?: typeof ctx.callbackQuery }, {
      callbackQuery: {
        data: 'city:almaty',
        message: { message_id: 150, chat: ctx.chat },
      } as typeof ctx.callbackQuery,
    });

    try {
      await dispatchAction('city:almaty', ctx);
    } finally {
      setUserCitySelectedMock.mock.restore();
    }

    assert.equal(cityMiddlewareExecuted, true);
    const menuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');
    assert.ok(menuStep, 'executor menu should be displayed after city callback');
    assert.equal(ctx.session.ui.pendingCityAction, undefined);
  });

  it('shows verification prompt and menu for courier after city callback without pending action', async () => {
    const setUserCitySelectedMock = mock.method(
      usersService,
      'setUserCitySelected',
      async () => undefined,
    );

    const { bot, dispatchAction } = createMockBot();
    registerCityAction(bot);
    registerExecutorMenu(bot);
    registerExecutorVerification(bot);

    const { ctx } = createMockContext();
    ctx.session.city = undefined;
    ctx.auth.user.citySelected = undefined;
    ctx.session.ui.pendingCityAction = EXECUTOR_MENU_CITY_ACTION;

    Object.assign(ctx as BotContext & { callbackQuery?: typeof ctx.callbackQuery }, {
      callbackQuery: {
        data: 'city:almaty',
        message: { message_id: 250, chat: ctx.chat },
      } as typeof ctx.callbackQuery,
    });

    try {
      await dispatchAction('city:almaty', ctx);
    } finally {
      setUserCitySelectedMock.mock.restore();
    }

    const verificationPrompt = recordedSteps.find(
      (step) => step.id === 'executor:verification:prompt',
    );
    assert.ok(
      verificationPrompt,
      'courier should see verification prompt after selecting city without pending action',
    );

    const menuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');
    assert.ok(menuStep, 'executor menu should be displayed after verification prompt');
    assert.equal(ctx.session.executor.verification.courier.status, 'collecting');
  });

  it('retains the session executor role during guest fallback city callbacks', async () => {
    const setUserCitySelectedMock = mock.method(
      usersService,
      'setUserCitySelected',
      async () => undefined,
    );

    const { bot, dispatchAction } = createMockBot();
    registerCityAction(bot);
    registerExecutorMenu(bot);
    registerExecutorVerification(bot);

    const { ctx } = createMockContext();
    ctx.session.city = undefined;
    ctx.auth.user.citySelected = undefined;
    ctx.session.ui.pendingCityAction = EXECUTOR_MENU_CITY_ACTION;

    // Simulate a temporary auth failure (guest fallback) while the session still knows the role.
    ctx.session.isAuthenticated = false;
    ctx.auth.user.role = 'guest';

    Object.assign(ctx as BotContext & { callbackQuery?: typeof ctx.callbackQuery }, {
      callbackQuery: {
        data: 'city:almaty',
        message: { message_id: 350, chat: ctx.chat },
      } as typeof ctx.callbackQuery,
    });

    try {
      await dispatchAction('city:almaty', ctx);
    } finally {
      setUserCitySelectedMock.mock.restore();
    }

    const verificationPrompt = recordedSteps.find(
      (step) => step.id === 'executor:verification:prompt',
    );
    assert.ok(
      verificationPrompt,
      'guest fallback should still route through executor verification using the session role',
    );

    const menuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');
    assert.ok(
      menuStep,
      'executor menu should be displayed after verification even when auth falls back to guest',
    );

    // The guest fallback should not wipe executor role information from the session.
    assert.equal(ctx.session.executor.role, 'courier');
  });

  it('shows the executor menu when auth reports guest but the cached executor role is available', async () => {
    const setUserCitySelectedMock = mock.method(
      usersService,
      'setUserCitySelected',
      async () => undefined,
    );

    const { bot, dispatchAction } = createMockBot();
    registerCityAction(bot);
    registerExecutorMenu(bot);
    registerExecutorVerification(bot);

    const { ctx } = createMockContext();
    ctx.session.city = undefined;
    ctx.auth.user.citySelected = undefined;
    ctx.session.ui.pendingCityAction = undefined;

    ctx.session.isAuthenticated = false;
    ctx.auth.user.role = 'guest';
    ctx.session.executor.role = 'courier';

    Object.assign(ctx as BotContext & { callbackQuery?: typeof ctx.callbackQuery }, {
      callbackQuery: {
        data: 'city:almaty',
        message: { message_id: 360, chat: ctx.chat },
      } as typeof ctx.callbackQuery,
    });

    try {
      await dispatchAction('city:almaty', ctx);
    } finally {
      setUserCitySelectedMock.mock.restore();
    }

    const menuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');
    assert.ok(
      menuStep,
      'executor menu should still be displayed when auth falls back to guest but session has executor role',
    );
  });

  it('keeps clients in the client menu when changing the city', async () => {
    const setUserCitySelectedMock = mock.method(
      usersService,
      'setUserCitySelected',
      async () => undefined,
    );

    const { bot, dispatchAction } = createMockBot();
    registerCityAction(bot);
    registerExecutorMenu(bot);

    const { ctx } = createMockContext();
    ctx.auth.user.role = 'client';
    ctx.auth.user.status = 'active_client';
    ctx.session.city = undefined;
    ctx.auth.user.citySelected = undefined;
    ctx.session.ui.pendingCityAction = 'clientMenu';

    Object.assign(ctx as BotContext & { callbackQuery?: typeof ctx.callbackQuery }, {
      callbackQuery: {
        data: 'city:almaty',
        message: { message_id: 350, chat: ctx.chat },
      } as typeof ctx.callbackQuery,
    });

    try {
      await dispatchAction('city:almaty', ctx);
    } finally {
      setUserCitySelectedMock.mock.restore();
    }

    ensureExecutorState(ctx);
    const verificationPrompt = recordedSteps.find(
      (step) => step.id === 'executor:verification:prompt',
    );
    const executorMenuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');

    assert.equal(verificationPrompt, undefined);
    assert.equal(executorMenuStep, undefined);
    assert.equal(ctx.session.executor.role, undefined);
    assert.equal(ctx.session.executor.verification.courier.status, 'idle');
    assert.equal(ctx.session.ui.pendingCityAction, 'clientMenu');
    const containsExecutorCopy = recordedSteps.some((step) =>
      typeof step.text === 'string' && step.text.includes('Статус проверки'),
    );
    assert.equal(containsExecutorCopy, false);
  });

  it('starts driver verification after confirming the work city', async () => {
    const setChatCommandsMock = mock.method(
      commandsService,
      'setChatCommands',
      async () => undefined,
    );
    const updateUserRoleMock = mock.method(usersDb, 'updateUserRole', async () => undefined);
    const setUserCitySelectedMock = mock.method(
      usersService,
      'setUserCitySelected',
      async () => undefined,
    );

    const { bot, getAction, dispatchAction } = createMockBot();
    registerCityAction(bot);
    registerExecutorRoleSelect(bot);
    registerExecutorMenu(bot);
    registerExecutorVerification(bot);

    const handler = getAction(ROLE_DRIVER_ACTION);
    assert.ok(handler, 'driver role action should be registered');

    const { ctx } = createMockContext();

    try {
      await handler(ctx);
      assert.equal(ctx.session.ui.pendingCityAction, EXECUTOR_MENU_CITY_ACTION);

      Object.assign(ctx as BotContext & { callbackQuery?: typeof ctx.callbackQuery }, {
        callbackQuery: {
          data: 'city:almaty',
          message: { message_id: 101, chat: ctx.chat },
        } as typeof ctx.callbackQuery,
      });

      await dispatchAction('city:almaty', ctx);
    } finally {
      setChatCommandsMock.mock.restore();
      updateUserRoleMock.mock.restore();
      setUserCitySelectedMock.mock.restore();
    }

    const verificationPrompt = recordedSteps.find(
      (step) => step.id === 'executor:verification:prompt',
    );
    assert.ok(verificationPrompt, 'verification prompt should be shown after city confirmation');
    assert.match(verificationPrompt.text, /водительского удостоверения/i);

    const menuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');
    assert.ok(menuStep, 'executor menu should be displayed after verification prompt');
    assert.equal(ctx.session.executor.verification.driver.status, 'collecting');
  });

  it('requires driver verification even when courier role was verified earlier', async () => {
    const setChatCommandsMock = mock.method(
      commandsService,
      'setChatCommands',
      async () => undefined,
    );
    const updateUserRoleMock = mock.method(usersDb, 'updateUserRole', async () => undefined);
    const setUserCitySelectedMock = mock.method(
      usersService,
      'setUserCitySelected',
      async () => undefined,
    );

    const { bot, getAction, dispatchAction } = createMockBot();
    registerCityAction(bot);
    registerExecutorRoleSelect(bot);
    registerExecutorMenu(bot);
    registerExecutorVerification(bot);

    const handler = getAction(ROLE_DRIVER_ACTION);
    assert.ok(handler, 'driver role action should be registered');

    const { ctx } = createMockContext();
    ctx.auth.executor.verifiedRoles.courier = true;
    ctx.auth.executor.isVerified = true;

    try {
      await handler(ctx);
      assert.equal(ctx.session.ui.pendingCityAction, EXECUTOR_MENU_CITY_ACTION);

      Object.assign(ctx as BotContext & { callbackQuery?: typeof ctx.callbackQuery }, {
        callbackQuery: {
          data: 'city:almaty',
          message: { message_id: 202, chat: ctx.chat },
        } as typeof ctx.callbackQuery,
      });

      await dispatchAction('city:almaty', ctx);
    } finally {
      setChatCommandsMock.mock.restore();
      updateUserRoleMock.mock.restore();
      setUserCitySelectedMock.mock.restore();
    }

    const verificationPrompt = recordedSteps.find(
      (step) => step.id === 'executor:verification:prompt',
    );
    assert.ok(verificationPrompt, 'driver verification should still be requested');
    assert.match(verificationPrompt.text, /водительского удостоверения/i);
    assert.equal(ctx.session.executor.verification.driver.status, 'collecting');
  });
});
