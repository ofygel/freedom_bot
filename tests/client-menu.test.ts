import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Telegraf } from 'telegraf';
import type { InlineKeyboardButton, InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
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

const expectedMenuText = [
  '🎯 Меню клиента Freedom Bot',
  '',
  'Выберите, что хотите оформить:',
  '• 🚕 Такси — подача машины и поездка по указанному адресу.',
  '• 📦 Доставка — курьер заберёт и доставит вашу посылку.',
].join('\n');

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
});

const createMockBot = () => {
  const actions = new Map<string, (ctx: BotContext) => Promise<void>>();
  const commands = new Map<string, (ctx: BotContext) => Promise<void>>();

  const bot: Partial<Telegraf<BotContext>> = {};
  bot.action = (trigger: string, handler: (ctx: BotContext) => Promise<void>) => {
    actions.set(trigger, handler);
    return bot as Telegraf<BotContext>;
  };
  bot.command = (command: string, handler: (ctx: BotContext) => Promise<void>) => {
    commands.set(command, handler);
    return bot as Telegraf<BotContext>;
  };

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
  let answerCbQueryCount = 0;

  const ctx = {
    chat: { id: 99, type: 'private' as const },
    session,
    reply: async (text: string, extra?: unknown) => {
      const messageId = nextMessageId++;
      replyCalls.push({ text, extra, messageId });
      return { message_id: messageId, chat: { id: 99 }, text };
    },
    telegram: {
      editMessageText: async () => true,
      deleteMessage: async () => true,
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

  return { ctx, replyCalls, editMarkupCalls, getAnswerCbQueryCount: () => answerCbQueryCount };
};

const getButtonText = (button: InlineKeyboardButton): string => {
  if ('text' in button) {
    return button.text;
  }
  throw new Error('Unsupported button type');
};

describe('client menu role selection', () => {
  it('clears the role keyboard and shows the client menu', async () => {
    const { bot, getAction } = createMockBot();
    registerClientMenu(bot);

    const handler = getAction(ROLE_CLIENT_ACTION);
    assert.ok(handler, 'Client role action should be registered');

    const { ctx, replyCalls, editMarkupCalls, getAnswerCbQueryCount } = createMockContext();

    await handler(ctx);

    assert.equal(editMarkupCalls.length, 1);
    assert.equal(editMarkupCalls[0], undefined);
    assert.equal(getAnswerCbQueryCount(), 1);

    assert.equal(replyCalls.length, 1);
    assert.equal(replyCalls[0].text, expectedMenuText);

    const keyboard = (replyCalls[0].extra as { reply_markup?: InlineKeyboardMarkup }).reply_markup;
    assert.ok(keyboard, 'Client menu keyboard should be provided');

    const labels = keyboard.inline_keyboard.map((row) => row.map(getButtonText));
    assert.deepEqual(labels, [
      ['🚕 Заказать такси'],
      ['📦 Заказать доставку'],
      ['🔄 Обновить меню'],
    ]);
  });
});
