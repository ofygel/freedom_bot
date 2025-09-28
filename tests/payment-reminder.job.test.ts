import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Telegraf } from 'telegraf';

import type { AuthState, BotContext, SessionState } from '../src/bot/types';
import { ui, type UiStepOptions } from '../src/bot/ui';
import * as executorMenu from '../src/bot/flows/executor/menu';
import { __testing__ as paymentReminderTesting } from '../src/jobs/paymentReminder';
import { pool } from '../src/db/client';
import type { PoolClient } from '../src/db/client';
import * as sessionsDb from '../src/db/sessions';
import * as authMiddleware from '../src/bot/middlewares/auth';

const { executeReminderCycle, REMINDER_INTERVAL_MS } = paymentReminderTesting;

type QueryResult = { rows: any[] };

type QueryHandler = (sql: string, params?: unknown[]) => Promise<QueryResult>;

const DEFAULT_CITY = 'almaty' as const;

const createAuthState = (telegramId: number): AuthState => ({
  user: {
    telegramId,
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
    trialEndsAt: undefined,
  },
  executor: {
    verifiedRoles: { courier: false, driver: false },
    hasActiveSubscription: false,
    isVerified: false,
  },
  isModerator: false,
});

const createSessionState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: true,
  awaitingPhone: false,
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
    role: 'courier',
    verification: {
      courier: { status: 'idle', requiredPhotos: 2, uploadedPhotos: [] },
      driver: { status: 'idle', requiredPhotos: 2, uploadedPhotos: [] },
    },
    subscription: {
      status: 'idle',
    },
  },
  client: {
    taxi: { stage: 'idle' },
    delivery: { stage: 'idle' },
  },
  ui: { steps: {}, homeActions: [], pendingCityAction: undefined },
  support: { status: 'idle' },
});

const createBot = () => {
  const telegram = {
    sendMessage: mock.fn(async () => ({ message_id: 1, date: 0, chat: { id: 1001 } })),
    editMessageText: mock.fn(async () => true),
    deleteMessage: mock.fn(async () => true),
    copyMessage: mock.fn(async () => true),
  };

  return { telegram } as unknown as Telegraf<BotContext>;
};

describe('payment reminder job', () => {
  let originalConnect: typeof pool.connect;
  let loadSessionStateMock: ReturnType<typeof mock.method>;
  let saveSessionStateMock: ReturnType<typeof mock.method>;
  let loadAuthStateMock: ReturnType<typeof mock.method>;
  let recordedSteps: UiStepOptions[];
  let originalStep: typeof ui.step;
  let showExecutorMenuMock: ReturnType<typeof mock.method>;

  beforeEach(() => {
    originalConnect = pool.connect;
    loadSessionStateMock = mock.method(sessionsDb, 'loadSessionState', async () => createSessionState());
    saveSessionStateMock = mock.method(sessionsDb, 'saveSessionState', async () => undefined);
    loadAuthStateMock = mock.method(authMiddleware, 'loadAuthStateByTelegramId', async (telegramId: number) =>
      createAuthState(telegramId),
    );

    recordedSteps = [];
    originalStep = ui.step;
    (ui as { step: typeof ui.step }).step = mock.fn(async (_ctx, options) => {
      recordedSteps.push(options);
      return { messageId: recordedSteps.length, sent: true };
    });

    showExecutorMenuMock = mock.method(executorMenu, 'showExecutorMenu', async () => undefined);
  });

  afterEach(() => {
    pool.connect = originalConnect;
    loadSessionStateMock.mock.restore();
    saveSessionStateMock.mock.restore();
    loadAuthStateMock.mock.restore();
    (ui as { step: typeof ui.step }).step = originalStep;
    showExecutorMenuMock.mock.restore();
  });

  const stubQueries = (handler: QueryHandler): void => {
    pool.connect = async (): Promise<PoolClient> => ({
      query: handler,
      release: () => {},
    } as unknown as PoolClient);
  };

  it('sends a reminder when awaitingReceipt is stale', async () => {
    const now = new Date('2024-01-01T10:00:00Z');
    const session = createSessionState();
    session.executor.subscription.status = 'awaitingReceipt';
    session.executor.subscription.lastReminderAt = now.getTime() - 3 * 60 * 60 * 1000;

    loadSessionStateMock.mock.mockImplementation(async () => session);

    const query: QueryHandler = async (sql) => {
      if (sql.includes("state->'executor'->'subscription'->>'status' = 'awaitingReceipt'")) {
        return { rows: [{ scope_id: '1001' }] };
      }
      if (sql.includes('trial_ends_at')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    };

    stubQueries(query);

    const bot = createBot();

    await executeReminderCycle(bot, now);

    assert.equal(recordedSteps.length, 1);
    assert.match(recordedSteps[0]!.text, /ожидаем чек/i);
    assert.equal(showExecutorMenuMock.mock.callCount(), 1);
    assert.equal(saveSessionStateMock.mock.callCount(), 1);
    assert.equal(session.executor.subscription.lastReminderAt, now.getTime());
  });

  it('skips reminders if the previous one was sent less than 2 hours ago', async () => {
    const now = new Date('2024-01-01T12:00:00Z');
    const session = createSessionState();
    session.executor.subscription.status = 'awaitingReceipt';
    session.executor.subscription.lastReminderAt =
      now.getTime() - (REMINDER_INTERVAL_MS - 15 * 60 * 1000);

    loadSessionStateMock.mock.mockImplementation(async () => session);

    const query: QueryHandler = async (sql) => {
      if (sql.includes("state->'executor'->'subscription'->>'status' = 'awaitingReceipt'")) {
        return { rows: [{ scope_id: '1001' }] };
      }
      if (sql.includes('trial_ends_at')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    };

    stubQueries(query);

    const bot = createBot();

    await executeReminderCycle(bot, now);

    assert.equal(recordedSteps.length, 0);
    assert.equal(showExecutorMenuMock.mock.callCount(), 0);
    assert.equal(saveSessionStateMock.mock.callCount(), 0);
  });

  it('reminds executors when the trial period ends soon', async () => {
    const now = new Date('2024-01-02T08:00:00Z');
    const trialEndsAt = new Date(now.getTime() + 60 * 60 * 1000);
    const session = createSessionState();
    session.executor.subscription.status = 'idle';
    session.executor.subscription.lastReminderAt = now.getTime() - 3 * 60 * 60 * 1000;

    loadSessionStateMock.mock.mockImplementation(async () => session);
    loadAuthStateMock.mock.mockImplementation(async (telegramId: number) => {
      const auth = createAuthState(telegramId);
      auth.user.trialEndsAt = trialEndsAt;
      return auth;
    });

    const query: QueryHandler = async (sql) => {
      if (sql.includes("state->'executor'->'subscription'->>'status' = 'awaitingReceipt'")) {
        return { rows: [] };
      }
      if (sql.includes('trial_ends_at')) {
        return { rows: [{ scope_id: '1001', trial_ends_at: trialEndsAt.toISOString() }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    };

    stubQueries(query);

    const bot = createBot();

    await executeReminderCycle(bot, now);

    assert.equal(recordedSteps.length, 1);
    assert.match(recordedSteps[0]!.text, /Пробный период/i);
    assert.equal(showExecutorMenuMock.mock.callCount(), 1);
    assert.equal(saveSessionStateMock.mock.callCount(), 1);
    assert.equal(session.executor.subscription.lastReminderAt, now.getTime());
  });
});
