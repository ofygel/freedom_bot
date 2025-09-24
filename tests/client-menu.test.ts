import './helpers/setup-env';

import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import type { Telegraf } from 'telegraf';
import type { KeyboardButton, ReplyKeyboardMarkup } from 'typegram';
import {
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type BotContext,
  type SessionState,
} from '../src/bot/types';
import type { AppCity } from '../src/domain/cities';
import { CLIENT_COMMANDS } from '../src/bot/commands/sets';

let registerClientMenu: typeof import('../src/bot/flows/client/menu')['registerClientMenu'];
let usersDb: typeof import('../src/db/users');
let commandsService: typeof import('../src/bot/services/commands');

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

  ({ registerClientMenu } = await import('../src/bot/flows/client/menu'));
  usersDb = await import('../src/db/users');
  commandsService = await import('../src/bot/services/commands');
});

const ROLE_CLIENT_ACTION = 'role:client';

const expectedMenuText = 'Добро пожаловать! Чем можем помочь?';
const DEFAULT_CITY: AppCity = 'almaty';

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

const createAuthState = (
  role: BotContext['auth']['user']['role'] = 'client',
): BotContext['auth'] => ({
  user: {
    telegramId: 42,
    username: undefined,
    firstName: undefined,
    lastName: undefined,
    phone: undefined,
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

const createMockBot = () => {
  const actions = new Map<string, (ctx: BotContext) => Promise<void>>();
  const commands = new Map<string, (ctx: BotContext) => Promise<void>>();
  const hears = new Map<string, (ctx: BotContext) => Promise<void>>();

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
  bot.command = (command: string, handler: (ctx: BotContext) => Promise<void>) => {
    commands.set(command, handler);
    return bot as Telegraf<BotContext>;
  };

  bot.hears = (((trigger: string, handler: (ctx: BotContext) => Promise<void>) => {
    hears.set(trigger, handler);
    return bot as Telegraf<BotContext>;
  }) as unknown) as Telegraf<BotContext>['hears'];

  return {
    bot: bot as Telegraf<BotContext>,
    getAction: (trigger: string) => actions.get(trigger),
    getCommand: (command: string) => commands.get(command),
    getHears: (trigger: string) => hears.get(trigger),
  };
};

type ContextFrom = NonNullable<BotContext['from']>;

interface MockContextOptions {
  role?: BotContext['auth']['user']['role'];
  from?: Partial<ContextFrom>;
  phoneNumber?: string;
}

const createMockContext = (options: MockContextOptions = {}) => {
  const session = createSessionState();
  if (options.phoneNumber) {
    session.phoneNumber = options.phoneNumber;
  }
  let nextMessageId = 1;
  const replyCalls: Array<{ text: string; extra?: unknown; messageId: number }> = [];
  const editMarkupCalls: Array<unknown> = [];
  const deleteMessageCalls: Array<unknown> = [];
  let answerCbQueryCount = 0;

  const from: ContextFrom = {
    id: 42,
    is_bot: false,
    first_name: 'Test',
    ...options.from,
  } as ContextFrom;

  const ctx = {
    chat: { id: 99, type: 'private' as const },
    from,
    session,
    auth: createAuthState(options.role),
    reply: async (text: string, extra?: unknown) => {
      const messageId = nextMessageId++;
      replyCalls.push({ text, extra, messageId });
      return { message_id: messageId, chat: { id: 99 }, text };
    },
    telegram: {
      editMessageText: async () => true,
      deleteMessage: async () => true,
    },
    deleteMessage: async () => {
      deleteMessageCalls.push(true);
      return true;
    },
    editMessageReplyMarkup: async (markup?: unknown) => {
      editMarkupCalls.push(markup);
      return true;
    },
    answerCbQuery: async () => {
      answerCbQueryCount += 1;
      return true;
    },
  } as unknown as BotContext;

  return {
    ctx,
    replyCalls,
    editMarkupCalls,
    deleteMessageCalls,
    getAnswerCbQueryCount: () => answerCbQueryCount,
  };
};

describe('client menu role selection', () => {
  it('clears the role keyboard and shows the client menu', async () => {
    const setChatCommandsMock = mock.method(
      commandsService,
      'setChatCommands',
      async () => undefined,
    );
    const { bot, getAction } = createMockBot();
    registerClientMenu(bot);

    const handler = getAction(ROLE_CLIENT_ACTION);
    assert.ok(handler, 'Client role action should be registered');

    const { ctx, replyCalls, editMarkupCalls, deleteMessageCalls, getAnswerCbQueryCount } =
      createMockContext();

    try {
      await handler(ctx);
    } finally {
      setChatCommandsMock.mock.restore();
    }

    assert.equal(deleteMessageCalls.length, 1);
    assert.equal(editMarkupCalls.length, 0);
    assert.equal(getAnswerCbQueryCount(), 1);

    assert.equal(replyCalls.length, 1);
    assert.equal(replyCalls[0].text, expectedMenuText);

    const keyboard = (replyCalls[0].extra as { reply_markup?: ReplyKeyboardMarkup }).reply_markup;
    assert.ok(keyboard, 'Client menu keyboard should be provided');

    const labels = keyboard.keyboard.map((row: KeyboardButton[]) =>
      row.map((button) => (typeof button === 'string' ? button : button.text)),
    );
    assert.deepEqual(labels, [
      ['🚕 Заказать такси', '📦 Доставка'],
      ['🧾 Мои заказы'],
      ['🆘 Поддержка', '🏙️ Сменить город'],
      ['👥 Сменить роль'],
      ['🔄 Обновить меню'],
    ]);
    assert.equal(keyboard.is_persistent, true);
    assert.equal(setChatCommandsMock.mock.callCount(), 1);
    const call = setChatCommandsMock.mock.calls[0];
    assert.ok(call);
    assert.equal(call.arguments[1], ctx.chat!.id);
    assert.deepEqual(call.arguments[2], CLIENT_COMMANDS);
  });

  it('updates executor role to client and shows the persistent menu immediately', async () => {
    const ensureClientRoleMock = mock.method(usersDb, 'ensureClientRole', async () => undefined);
    const setChatCommandsMock = mock.method(
      commandsService,
      'setChatCommands',
      async () => undefined,
    );

    const { bot, getAction } = createMockBot();
    registerClientMenu(bot);

    const handler = getAction(ROLE_CLIENT_ACTION);
    assert.ok(handler, 'Client role action should be registered');

    const {
      ctx,
      replyCalls,
      editMarkupCalls,
      deleteMessageCalls,
      getAnswerCbQueryCount,
    } = createMockContext({
      role: 'courier',
      from: {
        id: 42,
        username: 'executor_user',
        first_name: 'Exec',
        last_name: 'Utor',
      },
      phoneNumber: '+7 (700) 000-00-01',
    });

    try {
      await handler(ctx);
    } finally {
      ensureClientRoleMock.mock.restore();
      setChatCommandsMock.mock.restore();
    }

    assert.equal(ensureClientRoleMock.mock.callCount(), 1);
    const [dbCall] = ensureClientRoleMock.mock.calls;
    assert.ok(dbCall);
    const [payload] = dbCall.arguments;
    assert.deepEqual(payload, {
      telegramId: 42,
      username: 'executor_user',
      firstName: 'Exec',
      lastName: 'Utor',
      phone: '+7 (700) 000-00-01',
    });

    assert.equal(ctx.auth.user.role, 'client');
    assert.equal(ctx.session.isAuthenticated, true);
    assert.deepEqual(ctx.session.user, {
      id: 42,
      username: 'executor_user',
      firstName: 'Exec',
      lastName: 'Utor',
    });

    assert.equal(deleteMessageCalls.length, 1);
    assert.equal(editMarkupCalls.length, 0);
    assert.equal(getAnswerCbQueryCount(), 1);

    assert.equal(replyCalls.length, 1);
    assert.equal(replyCalls[0].text, expectedMenuText);

    const keyboard = (replyCalls[0].extra as { reply_markup?: ReplyKeyboardMarkup }).reply_markup;
    assert.ok(keyboard, 'Client menu keyboard should be provided');
    assert.equal(keyboard.is_persistent, true);
    assert.equal(setChatCommandsMock.mock.callCount(), 1);
  });

  it('opens role selection when the switch role button is used', async () => {
    const { bot, getHears } = createMockBot();
    registerClientMenu(bot);

    const handler = getHears('👥 Сменить роль');
    assert.ok(handler, 'Switch role handler should be registered');

    const { ctx, replyCalls } = createMockContext();

    await handler(ctx);

    assert.equal(replyCalls.length, 2);
    const firstMarkup = replyCalls[0].extra as { reply_markup?: ReplyKeyboardMarkup };
    assert.ok(firstMarkup?.reply_markup);
    assert.equal((firstMarkup.reply_markup as any).remove_keyboard, true);
    assert.match(replyCalls[1].text, /Выберите роль/);
  });

  it('opens role selection when the /role command is used', async () => {
    const { bot, getCommand } = createMockBot();
    registerClientMenu(bot);

    const handler = getCommand('role');
    assert.ok(handler, '/role command should be registered');

    const { ctx, replyCalls } = createMockContext();

    await handler(ctx);

    assert.equal(replyCalls.length, 2);
    const firstMarkup = replyCalls[0].extra as { reply_markup?: ReplyKeyboardMarkup };
    assert.ok(firstMarkup?.reply_markup);
    assert.equal((firstMarkup.reply_markup as any).remove_keyboard, true);
    assert.match(replyCalls[1].text, /Выберите роль/);
  });
});
