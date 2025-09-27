import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { clearSession, session } from '../src/bot/middlewares/session';
import type { BotContext } from '../src/bot/types';
import { pool } from '../src/db';
import * as sessionStorage from '../src/db/sessions';

type QueryHandler = (
  text: string,
  params?: ReadonlyArray<unknown>,
) => Promise<{ rows: unknown[] }>;

const createAuthState = (telegramId = 555): BotContext['auth'] => ({
  user: {
    telegramId,
    username: undefined,
    firstName: undefined,
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

const originalConnect = pool.connect.bind(pool);
const originalQuery = pool.query.bind(pool);

const normaliseSql = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

const createSessionQueryHandler = (store: Map<string, string>): QueryHandler => {
  return async (text, params = []) => {
    const normalised = normaliseSql(text);

    if (normalised.startsWith('begin') || normalised.startsWith('commit')) {
      return { rows: [] };
    }

    if (normalised.startsWith('rollback')) {
      return { rows: [] };
    }

    if (normalised.startsWith('select') && normalised.includes('from sessions')) {
      const [scope, scopeId] = params as [string, string];
      const key = `${scope}:${scopeId}`;
      const payload = store.get(key);
      if (!payload) {
        return { rows: [] };
      }
      return { rows: [{ state: JSON.parse(payload) }] };
    }

    if (normalised.startsWith('insert into sessions')) {
      const [scope, scopeId, payload] = params as [string, string, unknown];
      const key = `${scope}:${scopeId}`;
      const serialised =
        typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
      store.set(key, serialised);
      return { rows: [] };
    }

    if (normalised.startsWith('delete from sessions')) {
      const [scope, scopeId] = params as [string, string];
      const key = `${scope}:${scopeId}`;
      store.delete(key);
      return { rows: [] };
    }

    throw new Error(`Unexpected SQL in session middleware test: ${text}`);
  };
};

beforeEach(() => {
  const store = new Map<string, string>();
  const handler = createSessionQueryHandler(store);

  (pool as unknown as { connect: () => Promise<{ query: QueryHandler; release: () => void }> }).connect =
    async () => ({
      query: handler,
      release: () => {},
    });

  (pool as unknown as { query: QueryHandler }).query = handler;
});

afterEach(() => {
  (pool as unknown as { connect: typeof originalConnect }).connect = originalConnect;
  (pool as unknown as { query: typeof originalQuery }).query = originalQuery;
});

describe('session middleware', () => {
  it('resets session state to initial values after clearing', async () => {
    const middleware = session();
    const ctx = {
      chat: { id: 999, type: 'private' as const },
      from: { id: 555 },
      auth: createAuthState(555),
    } as unknown as BotContext;

    await middleware(ctx, async () => {
      ctx.session.isAuthenticated = true;
      ctx.session.phoneNumber = '+7 700 000 00 00';
      ctx.session.client.taxi.stage = 'collectingPickup';
      ctx.session.executor.subscription.status = 'awaitingReceipt';
      ctx.session.ui.steps['demo'] = { chatId: ctx.chat!.id!, messageId: 1, cleanup: true };
      ctx.session.ui.homeActions.push('home:demo');
      ctx.session.support.status = 'awaiting_message';
      ctx.session.support.lastThreadId = 'thread-demo';
      ctx.session.support.lastThreadShortId = 'demo1234';
    });

    assert.equal(ctx.session.isAuthenticated, true);
    assert.equal(ctx.session.client.taxi.stage, 'collectingPickup');
    assert.equal(ctx.session.executor.subscription.status, 'awaitingReceipt');
    assert.ok(ctx.session.ui.steps['demo']);
    assert.deepEqual(ctx.session.ui.homeActions, ['home:demo']);

    await clearSession(ctx);

    const ctx2 = {
      chat: { id: 999, type: 'private' as const },
      from: { id: 555 },
      auth: createAuthState(555),
    } as unknown as BotContext;
    await middleware(ctx2, async () => {});

    assert.equal(ctx2.session.isAuthenticated, false);
    assert.equal(ctx2.session.client.taxi.stage, 'idle');
    assert.equal(ctx2.session.executor.subscription.status, 'idle');
    assert.deepEqual(ctx2.session.ui.steps, {});
    assert.deepEqual(ctx2.session.ui.homeActions, []);
    assert.equal(ctx2.session.support.status, 'idle');
    assert.equal(ctx2.session.support.lastThreadId, undefined);
    assert.equal(ctx2.session.support.lastThreadShortId, undefined);
    assert.notStrictEqual(ctx2.session, ctx.session);

    await clearSession(ctx2);
  });

  it('falls back to default session state when database access fails', async () => {
    const middleware = session();
    const ctx = {
      chat: { id: 123, type: 'private' as const },
      from: { id: 456 },
      auth: createAuthState(456),
    } as unknown as BotContext;

    const sessionModule = sessionStorage as unknown as {
      saveSessionState: typeof sessionStorage.saveSessionState;
      deleteSessionState: typeof sessionStorage.deleteSessionState;
    };

    const originalSave = sessionModule.saveSessionState;
    const originalDelete = sessionModule.deleteSessionState;

    (pool as unknown as { connect: () => Promise<never> }).connect = async () => {
      throw new Error('database unavailable');
    };

    sessionModule.saveSessionState = (async () => {
      throw new Error('saveSessionState should not be called in fallback mode');
    }) as typeof sessionModule.saveSessionState;

    sessionModule.deleteSessionState = (async () => {
      throw new Error('deleteSessionState should not be called in fallback mode');
    }) as typeof sessionModule.deleteSessionState;

    let nextCalled = false;

    try {
      await middleware(ctx, async () => {
        nextCalled = true;
        assert.equal(ctx.session.isAuthenticated, false);
        assert.equal(ctx.session.client.taxi.stage, 'idle');
        assert.equal(ctx.session.executor.subscription.status, 'idle');
      });
    } finally {
      sessionModule.saveSessionState = originalSave;
      sessionModule.deleteSessionState = originalDelete;
    }

    assert.equal(nextCalled, true);
  });

  it('propagates errors from next when database connection fails', async () => {
    const middleware = session();
    const ctx = {
      chat: { id: 321, type: 'private' as const },
      from: { id: 654 },
      auth: createAuthState(654),
    } as unknown as BotContext;

    (pool as unknown as { connect: () => Promise<never> }).connect = async () => {
      throw new Error('database unavailable');
    };

    const nextError = new Error('next failed');

    await assert.rejects(
      async () =>
        middleware(ctx, async () => {
          throw nextError;
        }),
      (error: unknown) => error === nextError,
    );
  });
});
