import './helpers/setup-env';

import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import type { Telegraf } from 'telegraf';

import {
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type BotContext,
  type SessionState,
} from '../src/bot/types';
import { auth } from '../src/bot/middlewares/auth';
import { pool } from '../src/db';
import type { UiStepOptions } from '../src/bot/ui';

let executorMenuModule: typeof import('../src/bot/flows/executor/menu');
let clientMenuModule: typeof import('../src/bot/flows/client/menu');
let registerExecutorMenu: typeof import('../src/bot/flows/executor/menu')['registerExecutorMenu'];
let registerClientMenu: typeof import('../src/bot/flows/client/menu')['registerClientMenu'];
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

  executorMenuModule = await import('../src/bot/flows/executor/menu');
  clientMenuModule = await import('../src/bot/flows/client/menu');
  ({ registerExecutorMenu } = executorMenuModule);
  ({ registerClientMenu } = clientMenuModule);
  ({ ui: uiHelper } = await import('../src/bot/ui'));
});

const DEFAULT_CITY = 'almaty' as const;

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
    role: undefined,
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

const createAuthState = (role: BotContext['auth']['user']['role']): BotContext['auth'] => ({
  user: {
    telegramId: 101,
    username: undefined,
    firstName: undefined,
    lastName: undefined,
    phone: undefined,
    phoneVerified: false,
    role,
    status: role === 'client' || role === 'moderator' ? 'active_client' : 'active_executor',
    isVerified: false,
    isBlocked: false,
    citySelected: DEFAULT_CITY,
  },
  executor: {
    verifiedRoles: { courier: false, driver: false },
    hasActiveSubscription: false,
    isVerified: false,
  },
  isModerator: role === 'moderator',
});

const createContext = (role: BotContext['auth']['user']['role']): BotContext => {
  const session = createSessionState();
  session.executor.role = role === 'courier' || role === 'driver' ? role : undefined;

  const auth = createAuthState(role);

  return {
    chat: { id: 77, type: 'private' },
    from: { id: auth.user.telegramId },
    session,
    auth,
    reply: async () => ({
      message_id: 1,
      chat: { id: 77, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text: 'ok',
    }),
    telegram: {
      sendMessage: async () => ({
        message_id: 1,
        chat: { id: 77, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'ok',
      }),
      editMessageText: async () => true,
      deleteMessage: async () => true,
      setMyCommands: async () => undefined,
      setChatMenuButton: async () => undefined,
    },
    answerCbQuery: async () => undefined,
    deleteMessage: async () => true,
    editMessageReplyMarkup: async () => undefined,
    update: {} as never,
    updateType: 'message',
    botInfo: {} as never,
    state: {},
  } as unknown as BotContext;
};

type ActionHandler = (ctx: BotContext, next?: () => Promise<void>) => Promise<void>;

const createMockBot = () => {
  const commands = new Map<string, (ctx: BotContext) => Promise<void>>();
  const actions: Array<{ trigger: string | RegExp; handler: ActionHandler }> = [];

  const bot: Partial<Telegraf<BotContext>> = {
    telegram: {
      setMyCommands: async () => undefined,
      setChatMenuButton: async () => undefined,
    } as unknown as Telegraf<BotContext>['telegram'],
  };

  bot.action = (((trigger: string | RegExp, handler: ActionHandler) => {
    actions.push({ trigger, handler });
    return bot as Telegraf<BotContext>;
  }) as unknown) as Telegraf<BotContext>['action'];
  bot.hears = ((() => bot) as unknown) as Telegraf<BotContext>['hears'];
  bot.command = (((command: string, handler: (ctx: BotContext) => Promise<void>) => {
    commands.set(command, handler);
    return bot as Telegraf<BotContext>;
  }) as unknown) as Telegraf<BotContext>['command'];

  const triggerAction = async (payload: string, ctx: BotContext): Promise<void> => {
    const matchedActions = actions
      .map((entry) => {
        if (typeof entry.trigger === 'string') {
          if (entry.trigger !== payload) {
            return undefined;
          }

          return { entry, match: payload } as const;
        }

        entry.trigger.lastIndex = 0;
        const match = entry.trigger.exec(payload);
        if (!match) {
          return undefined;
        }

        return { entry, match } as const;
      })
      .filter(Boolean) as Array<{
      entry: { handler: ActionHandler };
      match: string | RegExpExecArray;
    }>;

    if (matchedActions.length === 0) {
      throw new Error(`Action handler not found for payload: ${payload}`);
    }

    const mutableCtx = ctx as BotContext & { match?: string | RegExpExecArray };

    const run = async (position: number): Promise<void> => {
      const candidate = matchedActions[position];
      if (!candidate) {
        return;
      }

      const {
        entry: { handler },
        match,
      } = candidate;

      const previousMatch = mutableCtx.match;
      mutableCtx.match = match;

      try {
        await handler(mutableCtx, async () => {
          await run(position + 1);
        });
      } finally {
        if (previousMatch !== undefined) {
          mutableCtx.match = previousMatch;
        } else {
          delete mutableCtx.match;
        }
      }
    };

    await run(0);
  };

  return {
    bot: bot as Telegraf<BotContext>,
    getCommand: (name: string) => commands.get(name),
    triggerAction,
  };
};

describe("/menu command routing", () => {
  it('shows the executor menu for couriers', async () => {
    const showExecutorMenuMock = mock.method(
      executorMenuModule,
      'showExecutorMenu',
      async () => undefined,
    );
    const showClientMenuMock = mock.method(clientMenuModule, 'showMenu', async () => undefined);

    const { bot, getCommand } = createMockBot();
    registerExecutorMenu(bot);

    const handler = getCommand('menu');
    assert.ok(handler, 'menu command should be registered');

    try {
      const ctx = createContext('courier');
      await handler(ctx);

      assert.equal(showExecutorMenuMock.mock.callCount(), 1);
      assert.equal(showClientMenuMock.mock.callCount(), 0);
    } finally {
      showExecutorMenuMock.mock.restore();
      showClientMenuMock.mock.restore();
    }
  });

  it('shows the executor menu when auth falls back to guest but the session has executor role', async () => {
    const showExecutorMenuMock = mock.method(
      executorMenuModule,
      'showExecutorMenu',
      async () => undefined,
    );
    const showClientMenuMock = mock.method(clientMenuModule, 'showMenu', async () => undefined);

    const { bot, getCommand } = createMockBot();
    registerExecutorMenu(bot);

    const handler = getCommand('menu');
    assert.ok(handler, 'menu command should be registered');

    const ctx = createContext('guest');
    ctx.session.isAuthenticated = false;
    ctx.session.executor.role = 'courier';

    try {
      await handler(ctx);

      assert.equal(showExecutorMenuMock.mock.callCount(), 1);
      assert.equal(showClientMenuMock.mock.callCount(), 0);
    } finally {
      showExecutorMenuMock.mock.restore();
      showClientMenuMock.mock.restore();
    }
  });

  it('shows the executor menu when guest auth fallback relies on the cached snapshot role', async () => {
    const showExecutorMenuMock = mock.method(
      executorMenuModule,
      'showExecutorMenu',
      async () => undefined,
    );
    const showClientMenuMock = mock.method(clientMenuModule, 'showMenu', async () => undefined);

    const { bot, getCommand } = createMockBot();
    registerExecutorMenu(bot);

    const handler = getCommand('menu');
    assert.ok(handler, 'menu command should be registered');

    const ctx = createContext('guest');
    ctx.session.isAuthenticated = false;
    ctx.session.authSnapshot.role = 'courier';
    ctx.session.authSnapshot.status = 'active_executor';
    ctx.session.authSnapshot.executor.verifiedRoles.courier = true;
    ctx.session.authSnapshot.executor.hasActiveSubscription = true;
    ctx.auth.executor.verifiedRoles.courier = true;
    ctx.auth.executor.hasActiveSubscription = true;

    try {
      await handler(ctx);

      assert.equal(showExecutorMenuMock.mock.callCount(), 1);
      assert.equal(showClientMenuMock.mock.callCount(), 0);
      assert.equal(ctx.session.executor.role, 'courier');
    } finally {
      showExecutorMenuMock.mock.restore();
      showClientMenuMock.mock.restore();
    }
  });

  it('shows verification prompt and menu when /menu runs during guest auth fallback', async () => {
    const { bot, getCommand } = createMockBot();
    registerExecutorMenu(bot);

    const handler = getCommand('menu');
    assert.ok(handler, 'menu command should be registered');

    const ctx = createContext('guest');
    ctx.session.isAuthenticated = false;
    ctx.session.executor.role = 'courier';
    ctx.auth.executor.verifiedRoles.courier = false;
    ctx.auth.executor.hasActiveSubscription = false;
    ctx.auth.executor.isVerified = false;

    Object.assign(ctx as BotContext & { message?: typeof ctx.message; update?: typeof ctx.update }, {
      updateType: 'message' as BotContext['updateType'],
      message: {
        message_id: 702,
        chat: ctx.chat,
        text: '/menu',
        from: ctx.from,
      } as typeof ctx.message,
      update: {
        message: {
          message_id: 702,
          chat: ctx.chat,
          text: '/menu',
          from: ctx.from,
        },
      } as typeof ctx.update,
    });

    const recordedSteps: UiStepOptions[] = [];
    const originalStep = uiHelper.step;
    (uiHelper as { step: typeof uiHelper.step }).step = async (_context, options) => {
      recordedSteps.push(options);
      return undefined;
    };

    try {
      await handler(ctx);
    } finally {
      (uiHelper as { step: typeof uiHelper.step }).step = originalStep;
    }

    const verificationPrompt = recordedSteps.find(
      (step) => step.id === 'executor:verification:prompt',
    );
    assert.ok(
      verificationPrompt,
      'verification prompt should be rendered when /menu runs during guest auth fallback',
    );

    const menuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');
    assert.ok(menuStep, 'executor menu should be shown after triggering verification');
    assert.equal(ctx.session.executor.verification.courier.status, 'collecting');
  });

  it('shows the client menu for client users', async () => {
    const showExecutorMenuMock = mock.method(
      executorMenuModule,
      'showExecutorMenu',
      async () => undefined,
    );
    const showClientMenuMock = mock.method(clientMenuModule, 'showMenu', async () => undefined);

    const { bot, getCommand } = createMockBot();
    registerExecutorMenu(bot);

    const handler = getCommand('menu');
    assert.ok(handler, 'menu command should be registered');

    try {
      const ctx = createContext('client');
      await handler(ctx);

      assert.equal(showExecutorMenuMock.mock.callCount(), 0);
      assert.equal(showClientMenuMock.mock.callCount(), 1);
    } finally {
      showExecutorMenuMock.mock.restore();
      showClientMenuMock.mock.restore();
    }
  });

  it('uses cached executor snapshot when auth query fails', async () => {
    const showExecutorMenuMock = mock.method(
      executorMenuModule,
      'showExecutorMenu',
      async () => undefined,
    );
    const showClientMenuMock = mock.method(clientMenuModule, 'showMenu', async () => undefined);

    const { bot, getCommand } = createMockBot();
    registerExecutorMenu(bot);

    const handler = getCommand('menu');
    assert.ok(handler, 'menu command should be registered');

    const session = createSessionState();
    session.isAuthenticated = true;
    session.user = {
      id: 101,
      username: 'cached_user',
      firstName: 'Cache',
      lastName: 'User',
      phoneVerified: true,
    };
    session.phoneNumber = '+7 700 000 00 00';
    session.executor.role = 'courier';
    session.authSnapshot = {
      role: 'courier',
      status: 'active_executor',
      phoneVerified: true,
      userIsVerified: true,
      executor: {
        verifiedRoles: { courier: true, driver: false },
        hasActiveSubscription: true,
        isVerified: true,
      },
      city: DEFAULT_CITY,
      stale: false,
    };

    const ctx = {
      chat: { id: 77, type: 'private' as const },
      from: {
        id: 101,
        username: 'cached_user',
        first_name: 'Cache',
        last_name: 'User',
      },
      session,
      auth: undefined as any,
      reply: async () => ({
        message_id: 1,
        chat: { id: 77, type: 'private' as const },
        date: Math.floor(Date.now() / 1000),
        text: 'ok',
      }),
      telegram: {
        sendMessage: async () => ({
          message_id: 1,
          chat: { id: 77, type: 'private' as const },
          date: Math.floor(Date.now() / 1000),
          text: 'ok',
        }),
        editMessageText: async () => true,
        deleteMessage: async () => true,
        setMyCommands: async () => undefined,
        setChatMenuButton: async () => undefined,
      },
      answerCbQuery: async () => undefined,
      update: { message: { chat: { id: 77, type: 'private' as const } } },
      updateType: 'message',
      botInfo: {} as never,
      state: {},
    } as unknown as BotContext;

    const authMiddleware = auth();
    const queryMock = mock.method(pool, 'query', async () => {
      throw new Error('temporary failure');
    });

    try {
      await authMiddleware(ctx, async () => {});

      assert.equal(ctx.session.isAuthenticated, false);
      assert.equal(ctx.session.authSnapshot.stale, true);
      assert.equal(ctx.session.authSnapshot.phoneVerified, true);
      assert.equal(ctx.session.authSnapshot.userIsVerified, true);
      assert.equal(ctx.session.authSnapshot.executor.verifiedRoles.courier, true);
      assert.equal(ctx.session.authSnapshot.executor.hasActiveSubscription, true);
      assert.equal(ctx.session.authSnapshot.status, 'active_executor');
      assert.equal(ctx.auth.user.role, 'courier');
      assert.equal(ctx.auth.user.status, 'active_executor');
      assert.equal(ctx.auth.user.phoneVerified, true);
      assert.equal(ctx.auth.user.isVerified, true);
      assert.equal(ctx.auth.executor.verifiedRoles.courier, true);
      assert.equal(ctx.auth.executor.hasActiveSubscription, true);
      assert.equal(ctx.auth.executor.isVerified, true);

      await handler(ctx);

      assert.equal(showExecutorMenuMock.mock.callCount(), 1);
      assert.equal(showClientMenuMock.mock.callCount(), 0);
    } finally {
      queryMock.mock.restore();
      showExecutorMenuMock.mock.restore();
      showClientMenuMock.mock.restore();
    }
  });

  it('renders the executor menu via city selection when guest auth fallback uses the session role', async () => {
    const showExecutorMenuMock = mock.method(
      executorMenuModule,
      'showExecutorMenu',
      async (ctx: BotContext) => {
        ctx.session.ui.pendingCityAction = executorMenuModule.EXECUTOR_MENU_CITY_ACTION;
      },
    );
    const showClientMenuMock = mock.method(clientMenuModule, 'showMenu', async () => undefined);

    const { bot, getCommand, triggerAction } = createMockBot();
    registerExecutorMenu(bot);

    const handler = getCommand('menu');
    assert.ok(handler, 'menu command should be registered');

    const session = createSessionState();
    session.city = undefined;
    session.executor.role = 'courier';
    session.authSnapshot = {
      role: 'courier',
      status: 'active_executor',
      phoneVerified: true,
      userIsVerified: true,
      executor: {
        verifiedRoles: { courier: true, driver: false },
        hasActiveSubscription: true,
        isVerified: true,
      },
      city: DEFAULT_CITY,
      stale: false,
    };

    const ctx = {
      chat: { id: 77, type: 'private' as const },
      from: {
        id: 101,
        username: 'cached_user',
        first_name: 'Cache',
        last_name: 'User',
      },
      session,
      auth: undefined as any,
      reply: async () => ({
        message_id: 1,
        chat: { id: 77, type: 'private' as const },
        date: Math.floor(Date.now() / 1000),
        text: 'ok',
      }),
      telegram: {
        sendMessage: async () => ({
          message_id: 1,
          chat: { id: 77, type: 'private' as const },
          date: Math.floor(Date.now() / 1000),
          text: 'ok',
        }),
        editMessageText: async () => true,
        deleteMessage: async () => true,
        setMyCommands: async () => undefined,
        setChatMenuButton: async () => undefined,
      },
      answerCbQuery: async () => undefined,
      update: { message: { chat: { id: 77, type: 'private' as const } } },
      updateType: 'message',
      botInfo: {} as never,
      state: {},
    } as unknown as BotContext;

    const authMiddleware = auth();
    const queryMock = mock.method(pool, 'query', async () => {
      throw new Error('temporary failure');
    });

    try {
      await authMiddleware(ctx, async () => {});

      assert.equal(ctx.auth.user.role, 'courier');
      assert.equal(ctx.auth.user.status, 'active_executor');
      assert.equal(ctx.session.isAuthenticated, false);

      await handler(ctx);

      assert.equal(showExecutorMenuMock.mock.callCount(), 1);
      assert.equal(showClientMenuMock.mock.callCount(), 0);

      ctx.session.ui.pendingCityAction = executorMenuModule.EXECUTOR_MENU_CITY_ACTION;
      ctx.session.city = DEFAULT_CITY;
      ctx.auth.user.citySelected = DEFAULT_CITY;

      await triggerAction('city:almaty', ctx);

      assert.equal(showExecutorMenuMock.mock.callCount(), 2);
      assert.equal(showClientMenuMock.mock.callCount(), 0);
      assert.equal(ctx.session.executor.role, 'courier');
    } finally {
      queryMock.mock.restore();
      showExecutorMenuMock.mock.restore();
      showClientMenuMock.mock.restore();
    }
  });

  it('keeps clients in the client menu flow when switching cities', async () => {
    const showExecutorMenuMock = mock.method(
      executorMenuModule,
      'showExecutorMenu',
      async () => undefined,
    );
    const showClientMenuMock = mock.method(clientMenuModule, 'showMenu', async () => undefined);

    const { bot, triggerAction } = createMockBot();
    registerClientMenu(bot);
    registerExecutorMenu(bot);

    const ctx = createContext('client');
    ctx.session.ui.pendingCityAction = 'clientMenu';

    try {
      await triggerAction('city:almaty', ctx);

      assert.equal(showExecutorMenuMock.mock.callCount(), 0);
      assert.equal(showClientMenuMock.mock.callCount(), 1);
    } finally {
      showExecutorMenuMock.mock.restore();
      showClientMenuMock.mock.restore();
    }
  });
});
