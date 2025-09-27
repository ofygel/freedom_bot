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

let executorMenuModule: typeof import('../src/bot/flows/executor/menu');
let clientMenuModule: typeof import('../src/bot/flows/client/menu');
let registerExecutorMenu: typeof import('../src/bot/flows/executor/menu')['registerExecutorMenu'];

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
});

const DEFAULT_CITY = 'almaty' as const;

const createSessionState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: true,
  awaitingPhone: false,
  phoneNumber: undefined,
  user: undefined,
  city: DEFAULT_CITY,
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

const createMockBot = () => {
  const commands = new Map<string, (ctx: BotContext) => Promise<void>>();

  const bot: Partial<Telegraf<BotContext>> = {
    telegram: {
      setMyCommands: async () => undefined,
      setChatMenuButton: async () => undefined,
    } as unknown as Telegraf<BotContext>['telegram'],
  };

  bot.action = ((() => bot) as unknown) as Telegraf<BotContext>['action'];
  bot.hears = ((() => bot) as unknown) as Telegraf<BotContext>['hears'];
  bot.command = (((command: string, handler: (ctx: BotContext) => Promise<void>) => {
    commands.set(command, handler);
    return bot as Telegraf<BotContext>;
  }) as unknown) as Telegraf<BotContext>['command'];

  return {
    bot: bot as Telegraf<BotContext>,
    getCommand: (name: string) => commands.get(name),
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

      assert.equal(ctx.session.isAuthenticated, true);
      assert.equal(ctx.session.authSnapshot?.stale, true);
      assert.equal(ctx.session.authSnapshot?.executor.verifiedRoles.courier, true);
      assert.equal(ctx.session.authSnapshot?.executor.hasActiveSubscription, true);
      assert.equal(ctx.auth.user.role, 'courier');
      assert.equal(ctx.auth.user.status, 'active_executor');
      assert.equal(ctx.auth.executor.hasActiveSubscription, true);

      await handler(ctx);

      assert.equal(showExecutorMenuMock.mock.callCount(), 1);
      assert.equal(showClientMenuMock.mock.callCount(), 0);
    } finally {
      queryMock.mock.restore();
      showExecutorMenuMock.mock.restore();
      showClientMenuMock.mock.restore();
    }
  });
});
