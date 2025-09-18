import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Telegraf } from 'telegraf';
import type { KeyboardButton, ReplyKeyboardMarkup } from 'typegram';
import {
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type BotContext,
  type SessionState,
} from '../src/bot/types';

let registerClientMenu: typeof import('../src/bot/flows/client/menu')['registerClientMenu'];

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
});

const ROLE_CLIENT_ACTION = 'role:client';

const expectedMenuText = 'Добро пожаловать! Чем можем помочь?';

const createSessionState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
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
    telegramId: 42,
    username: undefined,
    firstName: undefined,
    lastName: undefined,
    phone: undefined,
    role: 'client',
    isVerified: false,
    isBlocked: false,
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
  const commands = new Map<string, (ctx: BotContext) => Promise<void>>();

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

  bot.hears = ((() => bot as Telegraf<BotContext>) as unknown) as Telegraf<BotContext>['hears'];

  return {
    bot: bot as Telegraf<BotContext>,
    getAction: (trigger: string) => actions.get(trigger),
  };
};

const createMockContext = () => {
  const session = createSessionState();
  let nextMessageId = 1;
  const replyCalls: Array<{ text: string; extra?: unknown; messageId: number }> = [];
  const editMarkupCalls: Array<unknown> = [];
  const deleteMessageCalls: Array<unknown> = [];
  let answerCbQueryCount = 0;

  const ctx = {
    chat: { id: 99, type: 'private' as const },
    from: { id: 42 },
    session,
    auth: createAuthState(),
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
    const { bot, getAction } = createMockBot();
    registerClientMenu(bot);

    const handler = getAction(ROLE_CLIENT_ACTION);
    assert.ok(handler, 'Client role action should be registered');

    const { ctx, replyCalls, editMarkupCalls, deleteMessageCalls, getAnswerCbQueryCount } =
      createMockContext();

    await handler(ctx);

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
      ['🆘 Поддержка', '🔄 Обновить меню'],
    ]);
    assert.equal(keyboard.is_persistent, true);
  });
});
