import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { askPhone } from '../src/bot/flows/common/phoneCollect';
import { auth } from '../src/bot/middlewares/auth';
import { stateGate } from '../src/bot/middlewares/stateGate';
import type { BotContext, SessionState } from '../src/bot/types';
import { pool } from '../src/db';
import * as usersDb from '../src/db/users';

const originalQuery = pool.query.bind(pool);

const createSessionState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
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
    subscription: { status: 'idle' },
  },
  client: {
    taxi: { stage: 'idle' },
    delivery: { stage: 'idle' },
  },
  ui: { steps: {}, homeActions: [] },
  support: { status: 'idle' },
});

afterEach(() => {
  (pool as unknown as { query: typeof pool.query }).query = originalQuery;
});

describe('phone collection flow', () => {
  it('marks users as blocked when Telegram returns 403 and restores access afterwards', async () => {
    const telegramId = 501;
    const blockedError = Object.assign(new Error('Forbidden'), {
      error_code: 403,
      description: 'Forbidden: bot was blocked by the user',
    });

    const reply = mock.fn<(text: string, extra?: unknown) => Promise<never>>(async () => {
      throw blockedError;
    });

    const ctx = {
      from: { id: telegramId, username: 'blockeduser', first_name: 'Blocked', last_name: 'User' },
      chat: { id: telegramId, type: 'private' as const },
      reply,
      session: createSessionState(),
      auth: {
        user: {
          telegramId,
          username: 'blockeduser',
          firstName: 'Blocked',
          lastName: 'User',
          phone: '+7 700 000 00 01',
          phoneVerified: true,
          role: 'courier' as const,
          status: 'active_client' as const,
          isVerified: false,
          isBlocked: false,
        },
        executor: { verifiedRoles: { courier: false, driver: false }, hasActiveSubscription: false, isVerified: false },
        isModerator: false,
      },
    } as unknown as BotContext;

    const setBlockedStatusMock = mock.method(usersDb, 'setUserBlockedStatus', async () => undefined);

    await assert.doesNotReject(async () => {
      await askPhone(ctx);
    });

    assert.equal(reply.mock.callCount(), 1);
    assert.equal(ctx.session.awaitingPhone, false, 'awaitingPhone flag should not be set on 403');
    assert.deepEqual(ctx.session.ephemeralMessages, []);
    assert.equal(ctx.auth?.user?.isBlocked, true, 'auth state should mark user as blocked');
    assert.equal(ctx.auth?.user?.status, 'suspended', 'auth status should reflect suspension');

    assert.equal(setBlockedStatusMock.mock.callCount(), 1, 'blocked status should be persisted');
    const [dbCall] = setBlockedStatusMock.mock.calls;
    assert.ok(dbCall, 'setUserBlockedStatus should receive arguments');
    assert.deepEqual(dbCall.arguments[0], { telegramId, isBlocked: true });

    setBlockedStatusMock.mock.restore();

    let executedQuery: string | undefined;
    const queryStub = (async (
      ...args: Parameters<typeof pool.query>
    ) => {
      const [text] = args;
      if (typeof text === 'string' && text.includes('FROM information_schema.columns')) {
        return { rows: [{ exists: false }] } as any;
      }
      executedQuery = text as string;
      return {
        rows: [
          {
            tg_id: telegramId,
            username: 'blockeduser',
            first_name: 'Blocked',
            last_name: 'User',
            phone: '+7 700 000 00 01',
            phone_verified: true,
            role: 'courier',
            status: 'active_client',
            is_verified: false,
            is_blocked: false,
            courier_verified: false,
            driver_verified: false,
            has_active_subscription: false,
            verified_at: null,
            trial_ends_at: null,
            last_menu_role: null,
            keyboard_nonce: null,
          },
        ],
      } as any;
    }) as typeof pool.query;
    (pool as unknown as { query: typeof pool.query }).query = queryStub;

    const authMiddleware = auth();
    const authCtx = {
      from: { id: telegramId, username: 'blockeduser', first_name: 'Blocked', last_name: 'User' },
      chat: { id: telegramId, type: 'private' as const },
      update: { message: { chat: { id: telegramId, type: 'private' as const } } },
      session: createSessionState(),
      auth: undefined as any,
    } as unknown as BotContext;

    await authMiddleware(authCtx, async () => undefined);

    assert.ok(executedQuery?.includes('is_blocked = false'), 'auth upsert should reset blocked flag');
    assert.equal(authCtx.auth.user.isBlocked, false, 'auth state should clear blocked flag');
    assert.equal(authCtx.auth.user.status, 'active_client', 'auth status should reflect restored access');

    const gateCtx = {
      ...authCtx,
      message: { text: 'Привет' },
      reply: async () => undefined,
    } as unknown as BotContext;
    const gate = stateGate();
    let nextCalled = false;
    await gate(gateCtx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'stateGate should allow active users after unblock');
  });
});
