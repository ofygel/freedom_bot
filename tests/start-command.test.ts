import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import type { BotContext } from '../src/bot/types';
import { EXECUTOR_VERIFICATION_PHOTO_COUNT } from '../src/bot/types';
import { EXECUTOR_COMMANDS, CLIENT_COMMANDS } from '../src/bot/commands/sets';

let startCommandModule: typeof import('../src/bot/commands/start');
let registerStartCommand: typeof import('../src/bot/commands/start')['registerStartCommand'];
let askPhoneModule: typeof import('../src/bot/flows/common/phoneCollect');
let commandsService: typeof import('../src/bot/services/commands');
let executorVerificationModule: typeof import('../src/bot/flows/executor/verification');
let executorSubscriptionModule: typeof import('../src/bot/flows/executor/subscription');
let hideClientMenuModule: typeof import('../src/ui/clientMenu');

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

  askPhoneModule = await import('../src/bot/flows/common/phoneCollect');
  commandsService = await import('../src/bot/services/commands');
  startCommandModule = await import('../src/bot/commands/start');
  ({ registerStartCommand } = startCommandModule);
  executorVerificationModule = await import('../src/bot/flows/executor/verification');
  executorSubscriptionModule = await import('../src/bot/flows/executor/subscription');
  hideClientMenuModule = await import('../src/ui/clientMenu');
});

let askPhoneMock: ReturnType<typeof mock.method> | undefined;
let setChatCommandsMock: ReturnType<typeof mock.method> | undefined;
let startExecutorVerificationMock: ReturnType<typeof mock.method> | undefined;
let startExecutorSubscriptionMock: ReturnType<typeof mock.method> | undefined;
let presentRoleSelectionMock: ReturnType<typeof mock.method> | undefined;
let hideClientMenuMock: ReturnType<typeof mock.method> | undefined;

afterEach(() => {
  askPhoneMock?.mock.restore();
  setChatCommandsMock?.mock.restore();
  startExecutorVerificationMock?.mock.restore();
  startExecutorSubscriptionMock?.mock.restore();
  presentRoleSelectionMock?.mock.restore();
  hideClientMenuMock?.mock.restore();
  askPhoneMock = undefined;
  setChatCommandsMock = undefined;
  startExecutorVerificationMock = undefined;
  startExecutorSubscriptionMock = undefined;
  presentRoleSelectionMock = undefined;
  hideClientMenuMock = undefined;
});

const createMockBot = () => {
  let startHandler: ((ctx: BotContext) => Promise<void>) | undefined;
  const handlers = new Map<string, (ctx: BotContext) => Promise<void>>();
  const hearsHandlers: Array<{
    trigger: string | RegExp | string[];
    handler: (ctx: BotContext) => Promise<void>;
  }> = [];

  const bot = {
    start: (handler: typeof startHandler) => {
      startHandler = handler;
      return bot;
    },
    hears: (trigger: string | RegExp | string[], handler: (ctx: BotContext) => Promise<void>) => {
      hearsHandlers.push({ trigger, handler });
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
    triggerHears: async (text: string, ctx: BotContext) => {
      for (const { trigger, handler } of hearsHandlers) {
        if (typeof trigger === 'string') {
          if (trigger === text) {
            await handler(ctx);
          }
          continue;
        }

        if (Array.isArray(trigger)) {
          if (trigger.includes(text)) {
            await handler(ctx);
          }
          continue;
        }

        trigger.lastIndex = 0;
        if (trigger.test(text)) {
          trigger.lastIndex = 0;
          await handler(ctx);
        }
      }
    },
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

  (ctx as BotContext & { replyCalls: Array<{ text: string }> }).replyCalls = replyCalls;

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

  it('resumes executor verification when documents are being collected', async () => {
    askPhoneMock = mock.method(askPhoneModule, 'askPhone', async () => undefined);
    startExecutorVerificationMock = mock.method(
      executorVerificationModule,
      'startExecutorVerification',
      async () => undefined,
    );
    startExecutorSubscriptionMock = mock.method(
      executorSubscriptionModule,
      'startExecutorSubscription',
      async () => undefined,
    );
    presentRoleSelectionMock = mock.method(
      startCommandModule,
      'presentRoleSelection',
      async () => undefined,
    );

    const { bot, getStartHandler } = createMockBot();
    registerStartCommand(bot);
    const handler = getStartHandler();
    assert.ok(handler, 'start handler should be registered');

    const ctx = createContext('courier');
    ctx.session.user!.phoneVerified = true;
    ctx.auth.user.phoneVerified = true;
    ctx.session.executor = {
      role: 'courier',
      verification: {
        courier: {
          status: 'collecting',
          requiredPhotos: EXECUTOR_VERIFICATION_PHOTO_COUNT,
          uploadedPhotos: [],
          submittedAt: undefined,
          moderation: undefined,
        },
      },
      subscription: { status: 'idle' },
    } as any;

    await handler(ctx);

    assert.equal(startExecutorVerificationMock.mock.callCount(), 1);
    assert.equal(startExecutorSubscriptionMock.mock.callCount(), 0);
    assert.equal(presentRoleSelectionMock.mock.callCount(), 0);
  });

  for (const status of ['awaitingReceipt', 'pendingModeration'] as const) {
    it(`resumes executor subscription when status is ${status}`, async () => {
      askPhoneMock = mock.method(askPhoneModule, 'askPhone', async () => undefined);
      startExecutorVerificationMock = mock.method(
        executorVerificationModule,
        'startExecutorVerification',
        async () => undefined,
      );
      startExecutorSubscriptionMock = mock.method(
        executorSubscriptionModule,
        'startExecutorSubscription',
        async () => undefined,
      );
      presentRoleSelectionMock = mock.method(
        startCommandModule,
        'presentRoleSelection',
        async () => undefined,
      );

      const { bot, getStartHandler } = createMockBot();
      registerStartCommand(bot);
      const handler = getStartHandler();
      assert.ok(handler, 'start handler should be registered');

      const ctx = createContext('courier');
      ctx.session.user!.phoneVerified = true;
      ctx.auth.user.phoneVerified = true;
      ctx.session.executor = {
        role: 'courier',
        verification: {
          courier: {
            status: 'submitted',
            requiredPhotos: EXECUTOR_VERIFICATION_PHOTO_COUNT,
            uploadedPhotos: [],
            submittedAt: undefined,
            moderation: undefined,
          },
        },
        subscription: { status },
      } as any;

      await handler(ctx);

      assert.equal(startExecutorVerificationMock.mock.callCount(), 0);
      assert.equal(startExecutorSubscriptionMock.mock.callCount(), 1);
      const call = startExecutorSubscriptionMock.mock.calls[0];
      assert.ok(call);
      const options = call.arguments[1] as { skipVerificationCheck?: boolean } | undefined;
      assert.equal(options?.skipVerificationCheck, true);
      assert.equal(presentRoleSelectionMock.mock.callCount(), 0);
    });
  }

  it('presents role selection when no executor flow is pending', async () => {
    askPhoneMock = mock.method(askPhoneModule, 'askPhone', async () => undefined);
    startExecutorVerificationMock = mock.method(
      executorVerificationModule,
      'startExecutorVerification',
      async () => undefined,
    );
    startExecutorSubscriptionMock = mock.method(
      executorSubscriptionModule,
      'startExecutorSubscription',
      async () => undefined,
    );
    presentRoleSelectionMock = mock.method(
      startCommandModule,
      'presentRoleSelection',
      async () => undefined,
    );

    const { bot, getStartHandler } = createMockBot();
    registerStartCommand(bot);
    const handler = getStartHandler();
    assert.ok(handler, 'start handler should be registered');

    const ctx = createContext('courier');
    ctx.session.user!.phoneVerified = true;
    ctx.auth.user.phoneVerified = true;
    ctx.session.executor = {
      role: 'courier',
      verification: {
        courier: {
          status: 'submitted',
          requiredPhotos: EXECUTOR_VERIFICATION_PHOTO_COUNT,
          uploadedPhotos: [],
          submittedAt: undefined,
          moderation: undefined,
        },
      },
      subscription: { status: 'idle' },
    } as any;

    await handler(ctx);

    assert.equal(startExecutorVerificationMock.mock.callCount(), 0);
    assert.equal(startExecutorSubscriptionMock.mock.callCount(), 0);
    assert.equal(presentRoleSelectionMock.mock.callCount(), 1);
  });

  it('handles bare "start" text the same as /start when user is ready', async () => {
    askPhoneMock = mock.method(askPhoneModule, 'askPhone', async () => undefined);
    setChatCommandsMock = mock.method(commandsService, 'setChatCommands', async () => undefined);
    hideClientMenuMock = mock.method(hideClientMenuModule, 'hideClientMenu', async () => undefined);
    startExecutorVerificationMock = mock.method(
      executorVerificationModule,
      'startExecutorVerification',
      async () => undefined,
    );
    startExecutorSubscriptionMock = mock.method(
      executorSubscriptionModule,
      'startExecutorSubscription',
      async () => undefined,
    );
    presentRoleSelectionMock = mock.method(
      startCommandModule,
      'presentRoleSelection',
      async () => undefined,
    );

    const { bot, triggerHears } = createMockBot();
    registerStartCommand(bot);

    const ctx = createContext('courier');
    ctx.session.user!.phoneVerified = true;
    ctx.auth.user.phoneVerified = true;
    ctx.session.executor = {
      role: 'courier',
      verification: {
        courier: {
          status: 'submitted',
          requiredPhotos: EXECUTOR_VERIFICATION_PHOTO_COUNT,
          uploadedPhotos: [],
          submittedAt: undefined,
          moderation: undefined,
        },
      },
      subscription: { status: 'idle' },
    } as any;

    await triggerHears('start', ctx);

    assert.equal(askPhoneMock.mock.callCount(), 0);
    assert.equal(setChatCommandsMock.mock.callCount(), 1);
    const call = setChatCommandsMock.mock.calls[0];
    assert.ok(call);
    assert.equal(call.arguments[1], ctx.chat?.id);
    assert.deepEqual(call.arguments[2], EXECUTOR_COMMANDS);
    assert.equal(hideClientMenuMock.mock.callCount(), 1);
    assert.equal(startExecutorVerificationMock.mock.callCount(), 0);
    assert.equal(startExecutorSubscriptionMock.mock.callCount(), 0);
    assert.equal(presentRoleSelectionMock.mock.callCount(), 1);
  });
});
