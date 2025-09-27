import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import type { BotContext } from '../src/bot/types';

let registerStartCommand: typeof import('../src/bot/commands/start')['registerStartCommand'];
let registerClientMenu: typeof import('../src/bot/flows/client/menu')['registerClientMenu'];
let savePhone: typeof import('../src/bot/flows/common/phoneCollect')['savePhone'];
let askCityModule: typeof import('../src/bot/flows/common/citySelect');
let usersDb: typeof import('../src/db/users');
let dbClient: typeof import('../src/db/client');

before(async () => {
  registerStartCommand = (await import('../src/bot/commands/start')).registerStartCommand;
  registerClientMenu = (await import('../src/bot/flows/client/menu')).registerClientMenu;
  savePhone = (await import('../src/bot/flows/common/phoneCollect')).savePhone;
  askCityModule = await import('../src/bot/flows/common/citySelect');
  usersDb = await import('../src/db/users');
  dbClient = await import('../src/db/client');
});

const createSessionState = () => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
  phoneNumber: undefined as string | undefined,
  user: { id: 1001, phoneVerified: false },
  authSnapshot: {
    role: 'guest' as const,
    status: 'guest' as const,
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
    role: 'courier' as const,
    verification: {
      courier: { status: 'idle' as const, requiredPhotos: 2, uploadedPhotos: [] },
      driver: { status: 'idle' as const, requiredPhotos: 2, uploadedPhotos: [] },
    },
    subscription: { status: 'idle' as const },
  },
  client: {
    taxi: { stage: 'idle' as const },
    delivery: { stage: 'idle' as const },
  },
  ui: { steps: {}, homeActions: [], pendingCityAction: undefined as string | undefined },
  support: { status: 'idle' as const },
});

const createAuthState = (): BotContext['auth'] => ({
  user: {
    telegramId: 1001,
    username: undefined,
    firstName: 'Tester',
    lastName: undefined,
    phone: undefined,
    phoneVerified: false,
    role: 'client',
    status: 'active_client',
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
  let startHandler: ((ctx: BotContext) => Promise<void>) | undefined;
  const eventHandlers = new Map<string, (ctx: BotContext) => Promise<void>>();
  const actionHandlers = new Map<string, (ctx: BotContext) => Promise<void>>();

  const bot = {
    start(handler: typeof startHandler) {
      startHandler = handler;
      return bot;
    },
    on(event: string, handler: (ctx: BotContext) => Promise<void>) {
      eventHandlers.set(event, handler);
      return bot;
    },
    action(trigger: string, handler: (ctx: BotContext) => Promise<void>) {
      actionHandlers.set(trigger, handler);
      return bot;
    },
    command: () => bot,
    hears: () => bot,
    telegram: {
      setMyCommands: async () => undefined,
      setChatMenuButton: async () => undefined,
    },
  } as unknown as import('telegraf').Telegraf<BotContext>;

  return {
    bot,
    getStartHandler: () => startHandler,
    getEventHandler: (event: string) => eventHandlers.get(event),
    getActionHandler: (action: string) => actionHandlers.get(action),
  };
};

let ensureClientRoleMock: ReturnType<typeof mock.method> | undefined;
let askCityMock: ReturnType<typeof mock.method> | undefined;
let poolQueryMock: ReturnType<typeof mock.method> | undefined;

afterEach(() => {
  ensureClientRoleMock?.mock.restore();
  askCityMock?.mock.restore();
  poolQueryMock?.mock.restore();
  ensureClientRoleMock = undefined;
  askCityMock = undefined;
  poolQueryMock = undefined;
});

describe('start contact flow', () => {
  it('walks through start → phone → role → city prompts', async () => {
    const { bot, getStartHandler, getEventHandler, getActionHandler } = createMockBot();
    ensureClientRoleMock = mock.method(usersDb, 'ensureClientRole', async () => undefined);
    askCityMock = mock.method(askCityModule, 'askCity', async () => undefined);
    poolQueryMock = mock.method(dbClient.pool, 'query', async () => ({ rows: [], rowCount: 1 }));

    registerStartCommand(bot);
    registerClientMenu(bot);

    const startHandler = getStartHandler();
    const contactHandler = getEventHandler('contact');
    const roleHandler = getActionHandler('role:client');
    assert.ok(startHandler, 'start handler should be registered');
    assert.ok(contactHandler, 'contact handler should be registered');
    assert.ok(roleHandler, 'role handler should be registered');

    const session = createSessionState();
    const auth = createAuthState();
    const replies: Array<{ text: string; extra?: unknown }> = [];

    const setMyCommands = mock.fn<
      (commands: unknown, options: unknown) => Promise<void>
    >(async () => undefined);
    const setChatMenuButton = mock.fn<
      (options: unknown) => Promise<void>
    >(async () => undefined);

    const ctx = {
      chat: { id: 1001, type: 'private' as const },
      from: { id: 1001, is_bot: false, first_name: 'Tester' },
      session,
      auth,
      state: {},
      reply: async (text: string, extra?: unknown) => {
        replies.push({ text, extra });
        return { message_id: replies.length, chat: { id: 1001 }, text };
      },
      telegram: {
        setMyCommands,
        setChatMenuButton,
      },
    } as unknown as BotContext;

    await startHandler(ctx);
    assert.equal(replies.length, 1);
    assert.match(replies[0].text, /нужен ваш номер/i);
    assert.equal(session.awaitingPhone, true);

    const contactCtx = {
      ...ctx,
      message: {
        contact: { phone_number: '+77001234567', user_id: 1001 },
      } as BotContext['message'],
    } as BotContext;

    await savePhone(contactCtx, async () => {});
    assert.equal(session.phoneNumber, '+77001234567');
    assert.equal(session.user?.phoneVerified, true);
    assert.equal(ctx.auth.user.phoneVerified, true);
    assert.equal(replies.length, 2);
    assert.match(replies[1].text, /номер сохранён/i);

    await contactHandler(contactCtx);
    assert.equal(replies.length, 3);
    assert.match(replies[2].text, /Выберите роль/i);

    const roleCtx = {
      ...contactCtx,
      callbackQuery: { id: 'cbq', data: 'role:client' } as BotContext['callbackQuery'],
    } as BotContext;

    await roleHandler(roleCtx);

    assert.equal(askCityMock?.mock.callCount(), 1);
    const askCall = askCityMock?.mock.calls[0];
    assert.ok(askCall);
    assert.equal(askCall.arguments[0], roleCtx);
    assert.match(String(askCall.arguments[1]), /Укажите город/i);

    assert.equal(setMyCommands.mock.callCount(), 2);
    assert.equal(setChatMenuButton.mock.callCount(), 2);
  });
});
