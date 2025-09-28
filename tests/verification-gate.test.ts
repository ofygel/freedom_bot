import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import type { BotContext, SessionState } from '../src/bot/types';
import { EXECUTOR_VERIFICATION_PHOTO_COUNT } from '../src/bot/types';
import { ensureVerifiedExecutor } from '../src/bot/middlewares/verificationGate';
import {
  EXECUTOR_SUBSCRIPTION_ACTION,
  EXECUTOR_SUPPORT_ACTION,
} from '../src/bot/flows/executor/menu';
import * as verificationDb from '../src/db/verifications';
import * as verificationFlow from '../src/bot/flows/executor/verification';

const DEFAULT_CITY = 'almaty' as const;

const createSessionState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: false,
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
  ui: { steps: {}, homeActions: [], pendingCityAction: undefined },
  support: { status: 'idle' },
});

const createAuthState = (telegramId = 700): NonNullable<BotContext['auth']> => ({
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
  },
  executor: { verifiedRoles: { courier: false, driver: false }, hasActiveSubscription: false, isVerified: false },
  isModerator: false,
});

const createContext = () => {
  const session = createSessionState();
  const auth = createAuthState();

  const ctx = {
    chat: { id: auth.user.telegramId, type: 'private' as const },
    from: { id: auth.user.telegramId },
    session,
    auth,
  } as unknown as BotContext;

  const replyMock = mock.fn(async () => undefined);
  (ctx as unknown as { reply: typeof replyMock }).reply = replyMock;

  return { ctx, session, auth, replyMock };
};

describe('ensureVerifiedExecutor middleware', () => {
  let isExecutorVerifiedMock: ReturnType<typeof mock.method<typeof verificationDb, 'isExecutorVerified'>>;
  let startVerificationMock: ReturnType<typeof mock.method<typeof verificationFlow, 'startExecutorVerification'>>;

  beforeEach(() => {
    isExecutorVerifiedMock = mock.method(verificationDb, 'isExecutorVerified', async () => false);
    startVerificationMock = mock.method(verificationFlow, 'startExecutorVerification', async () => undefined);
  });

  afterEach(() => {
    isExecutorVerifiedMock.mock.restore();
    startVerificationMock.mock.restore();
  });

  it('allows city selection callbacks to pass through the gate', async () => {
    const { ctx } = createContext();

    (ctx as unknown as { callbackQuery: { data: string } }).callbackQuery = { data: 'city:almaty' };

    let nextCalled = false;
    await ensureVerifiedExecutor(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'city selection should reach dedicated handler');
    assert.equal(startVerificationMock.mock.callCount(), 0);
  });

  it('allows verification photo uploads while collecting', async () => {
    const { ctx, session } = createContext();

    const roleState = ctx.session.executor.verification.courier;
    roleState.status = 'collecting';

    (ctx as unknown as { message: { photo: { file_id: string }[] } }).message = {
      photo: [{ file_id: 'photo-1' }],
    };

    let nextCalled = false;
    await ensureVerifiedExecutor(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'photo upload should reach verification handler');
    assert.equal(startVerificationMock.mock.callCount(), 0);
    assert.equal(session.executor.verification.courier.status, 'collecting');
  });

  it('reminds about pending photos when collecting and receives a non-photo message', async () => {
    const { ctx, session, replyMock } = createContext();

    const roleState = ctx.session.executor.verification.courier;
    roleState.status = 'collecting';

    (ctx as unknown as { message: { text: string } }).message = { text: 'hello' };

    let nextCalled = false;
    await ensureVerifiedExecutor(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, 'non-photo message should not bypass the gate');
    assert.equal(startVerificationMock.mock.callCount(), 0);
    assert.equal(replyMock.mock.callCount(), 1);
    assert.equal(typeof session.executor.verification.courier.lastReminderAt, 'number');
  });

  it('allows /start command while collecting to reach downstream handlers', async () => {
    const { ctx } = createContext();

    const roleState = ctx.session.executor.verification.courier;
    roleState.status = 'collecting';

    (ctx as unknown as { message: { text: string } }).message = { text: '/start' };

    let nextCalled = false;
    await ensureVerifiedExecutor(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'commands should reach their handlers while collecting');
    assert.equal(startVerificationMock.mock.callCount(), 0);
  });

  it('allows role selection callbacks while collecting to reach downstream handlers', async () => {
    const { ctx } = createContext();

    const roleState = ctx.session.executor.verification.courier;
    roleState.status = 'collecting';

    (ctx as unknown as { callbackQuery: { data: string } }).callbackQuery = { data: 'role:client' };

    let nextCalled = false;
    await ensureVerifiedExecutor(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'role change should reach downstream handler');
    assert.equal(startVerificationMock.mock.callCount(), 0);
  });

  it('allows executor menu callbacks while collecting to reach downstream handlers', async () => {
    const { ctx } = createContext();

    const roleState = ctx.session.executor.verification.courier;
    roleState.status = 'collecting';

    (ctx as unknown as { callbackQuery: { data: string } }).callbackQuery = {
      data: EXECUTOR_SUBSCRIPTION_ACTION,
    };

    let nextCalled = false;
    await ensureVerifiedExecutor(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'executor menu callbacks should reach their handlers');
    assert.equal(startVerificationMock.mock.callCount(), 0);
  });

  it('allows support callback while collecting to reach downstream handlers', async () => {
    const { ctx } = createContext();

    const roleState = ctx.session.executor.verification.courier;
    roleState.status = 'collecting';

    (ctx as unknown as { callbackQuery: { data: string } }).callbackQuery = {
      data: EXECUTOR_SUPPORT_ACTION,
    };

    let nextCalled = false;
    await ensureVerifiedExecutor(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'support callback should reach downstream handler');
    assert.equal(startVerificationMock.mock.callCount(), 0);
  });

  it('starts verification when executor is not collecting yet', async () => {
    const { ctx } = createContext();

    await ensureVerifiedExecutor(ctx, async () => {});

    assert.equal(startVerificationMock.mock.callCount(), 1);
  });
});
