import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import type { BotContext } from '../src/bot/types';
import { EXECUTOR_COMMANDS, CLIENT_COMMANDS } from '../src/bot/commands/sets';

let registerStartCommand: typeof import('../src/bot/commands/start')['registerStartCommand'];
let askPhoneModule: typeof import('../src/bot/middlewares/askPhone');
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

  askPhoneModule = await import('../src/bot/middlewares/askPhone');
  commandsService = await import('../src/bot/services/commands');
  ({ registerStartCommand } = await import('../src/bot/commands/start'));
});

let askPhoneMock: ReturnType<typeof mock.method> | undefined;
let setChatCommandsMock: ReturnType<typeof mock.method> | undefined;

afterEach(() => {
  askPhoneMock?.mock.restore();
  setChatCommandsMock?.mock.restore();
  askPhoneMock = undefined;
  setChatCommandsMock = undefined;
});

const createMockBot = () => {
  let startHandler: ((ctx: BotContext) => Promise<void>) | undefined;
  const handlers = new Map<string, (ctx: BotContext) => Promise<void>>();

  const bot = {
    start: (handler: typeof startHandler) => {
      startHandler = handler;
      return bot;
    },
    on: (event: string, handler: (ctx: BotContext) => Promise<void>) => {
      handlers.set(event, handler);
      return bot;
    },
  } as any;

  return {
    bot,
    getStartHandler: () => startHandler,
    getHandler: (event: string) => handlers.get(event),
  };
};

const createContext = (role: BotContext['auth']['user']['role']): BotContext => {
  const replyCalls: Array<{ text: string }> = [];
  const ctx = {
    chat: { id: 9001, type: 'private' as const },
    from: { id: 9001, is_bot: false, first_name: 'User' },
    auth: {
      user: {
        telegramId: 9001,
        username: undefined,
        firstName: 'User',
        lastName: undefined,
        phone: undefined,
        phoneVerified: false,
        role,
        status: role === 'client' ? 'active_client' : 'active_executor',
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
    session: {
      ephemeralMessages: [],
      isAuthenticated: false,
      awaitingPhone: false,
      user: { id: 9001, phoneVerified: false },
      executor: { role: 'courier', verification: {} as any, subscription: { status: 'idle' } },
      client: { taxi: { stage: 'idle' }, delivery: { stage: 'idle' } },
      ui: { steps: {}, homeActions: [] },
      support: { status: 'idle' },
    },
    reply: async (text: string) => {
      replyCalls.push({ text });
      return { message_id: replyCalls.length, chat: { id: 9001 }, text };
    },
    telegram: {} as any,
  } as unknown as BotContext;

  return ctx;
};

describe('/start command', () => {
  it('requests phone number when user is not verified', async () => {
    askPhoneMock = mock.method(askPhoneModule, 'askPhone', async () => undefined);

    const { bot, getStartHandler } = createMockBot();
    registerStartCommand(bot);
    const handler = getStartHandler();
    assert.ok(handler, 'start handler should be registered');

    const ctx = createContext('client');
    await handler(ctx);

    assert.equal(askPhoneMock.mock.callCount(), 1);
  });

  it('installs client commands for client role', async () => {
    askPhoneMock = mock.method(askPhoneModule, 'askPhone', async () => undefined);
    setChatCommandsMock = mock.method(commandsService, 'setChatCommands', async () => undefined);

    const { bot, getStartHandler } = createMockBot();
    registerStartCommand(bot);
    const handler = getStartHandler();
    assert.ok(handler, 'start handler should be registered');

    const ctx = createContext('client');
    ctx.session.user!.phoneVerified = true;
    ctx.auth.user.phoneVerified = true;
    await handler(ctx);

    assert.equal(askPhoneMock.mock.callCount(), 0);
    assert.equal(setChatCommandsMock.mock.callCount(), 1);
    const call = setChatCommandsMock.mock.calls[0];
    assert.ok(call);
    assert.equal(call.arguments[1], ctx.chat?.id);
    assert.deepEqual(call.arguments[2], CLIENT_COMMANDS);
  });

  it('installs executor commands for courier role', async () => {
    askPhoneMock = mock.method(askPhoneModule, 'askPhone', async () => undefined);
    setChatCommandsMock = mock.method(commandsService, 'setChatCommands', async () => undefined);

    const { bot, getStartHandler } = createMockBot();
    registerStartCommand(bot);
    const handler = getStartHandler();
    assert.ok(handler, 'start handler should be registered');

    const ctx = createContext('courier');
    ctx.session.user!.phoneVerified = true;
    ctx.auth.user.phoneVerified = true;
    await handler(ctx);

    assert.equal(askPhoneMock.mock.callCount(), 0);
    assert.equal(setChatCommandsMock.mock.callCount(), 1);
    const call = setChatCommandsMock.mock.calls[0];
    assert.ok(call);
    assert.equal(call.arguments[1], ctx.chat?.id);
    assert.deepEqual(call.arguments[2], EXECUTOR_COMMANDS);
  });
});
