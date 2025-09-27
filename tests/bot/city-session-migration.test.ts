import '../helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import type { PoolClient } from 'pg';
import type { Telegraf } from 'telegraf';

import type { BotContext, SessionState } from '../../src/bot/types';
import { pool } from '../../src/db';
import * as sessionStorage from '../../src/db/sessions';
import * as usersService from '../../src/services/users';

let createSessionMiddleware: typeof import('../../src/bot/middlewares/session')['session'];
let registerCityAction: typeof import('../../src/bot/flows/common/citySelect')['registerCityAction'];
let registerExecutorMenu: typeof import('../../src/bot/flows/executor/menu')['registerExecutorMenu'];
let executorMenuModule: typeof import('../../src/bot/flows/executor/menu');
let uiModule: typeof import('../../src/bot/ui')['ui'];

before(async () => {
  ({ session: createSessionMiddleware } = await import('../../src/bot/middlewares/session'));
  ({ registerCityAction } = await import('../../src/bot/flows/common/citySelect'));
  executorMenuModule = await import('../../src/bot/flows/executor/menu');
  ({ registerExecutorMenu } = executorMenuModule);
  ({ ui: uiModule } = await import('../../src/bot/ui'));
});

type ActionHandler = (ctx: BotContext, next: () => Promise<void>) => Promise<void>;

type RegisteredAction = {
  trigger: string | RegExp;
  handler: ActionHandler;
};

const createMockBot = () => {
  const actions: RegisteredAction[] = [];

  const bot: Partial<Telegraf<BotContext>> = {
    telegram: {
      setMyCommands: async () => undefined,
      setChatMenuButton: async () => undefined,
    } as unknown as Telegraf<BotContext>['telegram'],
  };

  bot.action = (trigger: RegisteredAction['trigger'], handler: RegisteredAction['handler']) => {
    actions.push({ trigger, handler });
    return bot as Telegraf<BotContext>;
  };

  bot.command = () => bot as Telegraf<BotContext>;
  bot.hears = () => bot as Telegraf<BotContext>;
  bot.on = () => bot as Telegraf<BotContext>;

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

  return { bot: bot as Telegraf<BotContext>, dispatchAction };
};

const DEFAULT_CITY = 'almaty' as const;

const createAuthState = (): BotContext['auth'] => ({
  user: {
    telegramId: 555,
    phoneVerified: false,
    role: 'courier',
    status: 'active_executor',
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

const createMockContext = (): BotContext => {
  const auth = createAuthState();

  const ctx = {
    chat: { id: 999, type: 'private' as const },
    from: { id: auth.user.telegramId },
    auth,
    answerCbQuery: async () => undefined,
    editMessageText: async () => undefined,
    reply: async (_text: string, _extra?: unknown) => ({
      message_id: 1,
      chat: { id: 999, type: 'private' as const },
      date: Math.floor(Date.now() / 1000),
      text: 'ok',
    }),
    telegram: {
      editMessageText: async () => undefined,
      sendMessage: async () => ({
        message_id: 2,
        chat: { id: 999, type: 'private' as const },
        date: Math.floor(Date.now() / 1000),
        text: 'ok',
      }),
    } as unknown as Telegraf<BotContext>['telegram'],
    update: {} as never,
    updateType: 'callback_query',
    botInfo: {} as never,
    state: {},
  } as unknown as BotContext;

  return ctx;
};

let connectMock: ReturnType<typeof mock.method> | undefined;
let setUserCitySelectedMock: ReturnType<typeof mock.method> | undefined;
let trackStepMock: ReturnType<typeof mock.method> | undefined;

beforeEach(() => {
  connectMock = mock.method(pool, 'connect', async () => ({
    query: async () => ({ rows: [] }),
    release: () => undefined,
  }) as unknown as PoolClient);

  setUserCitySelectedMock = mock.method(usersService, 'setUserCitySelected', async () => undefined);
  trackStepMock = mock.method(uiModule, 'trackStep', async () => undefined);
});

afterEach(() => {
  connectMock?.mock.restore();
  connectMock = undefined;

  setUserCitySelectedMock?.mock.restore();
  setUserCitySelectedMock = undefined;

  trackStepMock?.mock.restore();
  trackStepMock = undefined;
});

describe('session migration for city callbacks', () => {
  it('restores missing branches and invokes the executor menu after selecting a city', async () => {
    const storedState: Partial<SessionState> = {
      ephemeralMessages: [],
      isAuthenticated: true,
      awaitingPhone: false,
      city: undefined,
      ui: { steps: {}, homeActions: [], pendingCityAction: 'executorMenu' },
      support: { status: 'idle' },
    };

    const loadMock = mock.method(sessionStorage, 'loadSessionState', async () => storedState as SessionState);
    const saveMock = mock.method(sessionStorage, 'saveSessionState', async () => undefined);

    const showMenuMock = mock.method(executorMenuModule, 'showExecutorMenu', async () => undefined);

    const middleware = createSessionMiddleware();
    const { bot, dispatchAction } = createMockBot();

    registerCityAction(bot);
    registerExecutorMenu(bot);

    const ctx = createMockContext();
    Object.assign(ctx, {
      callbackQuery: {
        data: 'city:almaty',
        message: { message_id: 1, chat: ctx.chat },
      },
    });

    let showMenuCallCount = 0;
    try {
      await middleware(ctx, async () => {
        await dispatchAction('city:almaty', ctx);
      });
    } finally {
      showMenuCallCount = showMenuMock.mock.callCount();
      loadMock.mock.restore();
      saveMock.mock.restore();
      showMenuMock.mock.restore();
    }

    assert.ok(ctx.session.executor, 'executor state should be rebuilt');
    assert.ok(ctx.session.client, 'client state should be rebuilt');
    assert.equal(showMenuCallCount, 1);
  });

  it('preserves verification and subscription progress when normalising executor state', async () => {
    const storedState: Partial<SessionState> = {
      ephemeralMessages: [],
      isAuthenticated: true,
      awaitingPhone: false,
      city: DEFAULT_CITY,
      executor: {
        role: 'driver',
        verification: {
          courier: {
            status: 'idle',
            requiredPhotos: 2,
            uploadedPhotos: [],
          },
          driver: {
            status: 'collecting',
            requiredPhotos: 2,
            uploadedPhotos: [
              { fileId: 'file-1', messageId: 101 },
              { fileId: 'file-2', messageId: 102, fileUniqueId: 'unique-2' },
            ],
          },
        },
        subscription: {
          status: 'awaitingReceipt',
          pendingPaymentId: 'payment-1',
        },
      },
      ui: { steps: {}, homeActions: [] },
      support: { status: 'idle' },
    };

    const loadMock = mock.method(sessionStorage, 'loadSessionState', async () => storedState as SessionState);
    const saveMock = mock.method(sessionStorage, 'saveSessionState', async () => undefined);

    const middleware = createSessionMiddleware();
    const ctx = createMockContext();

    try {
      await middleware(ctx, async () => {
        // No-op
      });
    } finally {
      loadMock.mock.restore();
      saveMock.mock.restore();
    }

    assert.equal(ctx.session.executor.role, 'driver');
    assert.equal(ctx.session.executor.verification.driver.status, 'collecting');
    assert.equal(ctx.session.executor.verification.driver.uploadedPhotos.length, 2);
    assert.equal(ctx.session.executor.verification.driver.uploadedPhotos[0]?.fileId, 'file-1');
    assert.equal(ctx.session.executor.verification.driver.uploadedPhotos[1]?.fileUniqueId, 'unique-2');
    assert.equal(ctx.session.executor.subscription.status, 'awaitingReceipt');
    assert.equal(ctx.session.executor.subscription.pendingPaymentId, 'payment-1');
    assert.equal(ctx.session.executor.verification.courier.status, 'idle');
  });
});
