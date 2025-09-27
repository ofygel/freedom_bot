import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Telegraf } from 'telegraf';

import { registerBindCommand } from '../src/bot/commands/bind';
import { auth } from '../src/bot/middlewares/auth';
import type { BotContext } from '../src/bot/types';
import { pool } from '../src/db';

type QueryFunction = (
  ...args: Parameters<typeof pool.query>
) => ReturnType<typeof pool.query>;

const originalQuery: QueryFunction = pool.query.bind(pool);

const setPoolQuery = (fn: QueryFunction) => {
  (pool as unknown as { query: QueryFunction }).query = fn;
};

const createSessionState = (): BotContext['session'] => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
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
  ui: {
    steps: {},
    homeActions: [],
  },
  support: {
    status: 'idle',
  },
});

const registerChannelPostHandler = () => {
  let handler: ((ctx: BotContext, next: () => Promise<void>) => Promise<void>) | undefined;

  const botStub = {
    command: () => botStub,
    on(event: string, middleware: (ctx: BotContext, next: () => Promise<void>) => Promise<void>) {
      if (event === 'channel_post') {
        handler = middleware;
      }
      return botStub;
    },
  } as unknown as Telegraf<BotContext>;

  registerBindCommand(botStub);

  if (!handler) {
    throw new Error('channel_post handler was not registered');
  }

  return handler;
};

afterEach(() => {
  setPoolQuery(originalQuery);
});

describe('auth middleware', () => {
  it('continues channel updates without sender information', async () => {
    let queryInvoked = false;
    const queryStub: QueryFunction = async (..._args) => {
      queryInvoked = true;
      return { rows: [] } as any;
    };
    setPoolQuery(queryStub);

    const middleware = auth();
    const ctx = {
      chat: { id: -100123456, type: 'channel' as const, title: 'Binding Channel' },
      channelPost: {
        chat: { id: -100123456, type: 'channel' as const, title: 'Binding Channel' },
        text: 'Привязка',
      },
      senderChat: { id: -100123456, type: 'channel' as const, title: 'Binding Channel' },
      update: { channel_post: { chat: { id: -100123456, type: 'channel' as const } } },
      session: createSessionState(),
      auth: undefined as any,
    } as unknown as BotContext;

    let nextCalled = false;
    await middleware(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(queryInvoked, false);
  });

  it('continues channel updates derived solely from raw payload', async () => {
    let queryInvoked = false;
    const queryStub: QueryFunction = async (..._args) => {
      queryInvoked = true;
      return { rows: [] } as any;
    };
    setPoolQuery(queryStub);

    const middleware = auth();
    const ctx = {
      update: {
        channel_post: {
          message_id: 42,
          chat: { id: -100111222, type: 'channel' as const, title: 'Raw Channel' },
          text: 'Привязка',
        },
      },
      session: createSessionState(),
      auth: undefined as any,
    } as unknown as BotContext;

    let nextCalled = false;
    await middleware(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(queryInvoked, false);
  });

  it('authenticates user updates and populates ctx.auth', async () => {
    const authRow = {
      tg_id: 321,
      username: 'authuser',
      first_name: 'Auth',
      last_name: 'User',
      phone: '+7 700 000 00 00',
      phone_verified: true,
      role: 'courier',
      is_verified: true,
      is_blocked: false,
      courier_verified: true,
      driver_verified: false,
      has_active_subscription: true,
    };

    const queryStub: QueryFunction = async (..._args) => ({ rows: [authRow] } as any);
    setPoolQuery(queryStub);

    const middleware = auth();
    const session = createSessionState();
    const ctx = {
      from: { id: 321, username: 'authuser', first_name: 'Auth', last_name: 'User' },
      chat: { id: 999, type: 'private' as const },
      update: { message: { chat: { id: 999, type: 'private' as const } } },
      session,
      auth: undefined as any,
    } as unknown as BotContext;

    await middleware(ctx, async () => {});

    assert.equal(ctx.session.isAuthenticated, true);
    assert.equal(ctx.auth.user.telegramId, 321);
    assert.equal(ctx.auth.user.username, 'authuser');
    assert.equal(ctx.session.authSnapshot.role, 'courier');
    assert.equal(ctx.session.authSnapshot.status, 'active_executor');
    assert.equal(ctx.session.authSnapshot.executor.verifiedRoles.courier, true);
    assert.equal(ctx.session.authSnapshot.executor.hasActiveSubscription, true);
    assert.equal(ctx.session.authSnapshot.executor.isVerified, true);
    assert.equal(ctx.session.authSnapshot.stale, false);
    assert.equal(ctx.session.user?.id, 321);
    assert.equal(ctx.session.phoneNumber, '+7 700 000 00 00');
  });

  it('falls back to guest auth state when the database query fails', async () => {
    const dbError = new Error('connection refused');
    setPoolQuery(async (..._args) => {
      throw dbError;
    });

    const middleware = auth();
    const session = createSessionState();
    let replyCalled = false;
    const ctx = {
      from: { id: 777, username: 'guestuser', first_name: 'Guest', last_name: 'User' },
      chat: { id: 42, type: 'private' as const },
      update: { message: { chat: { id: 42, type: 'private' as const } } },
      session,
      auth: undefined as any,
      reply: async () => {
        replyCalled = true;
      },
    } as unknown as BotContext;

    let nextInvoked = false;
    await middleware(ctx, async () => {
      nextInvoked = true;
    });

    assert.equal(nextInvoked, true);
    assert.equal(ctx.auth.user.role, 'guest');
    assert.equal(ctx.auth.user.status, 'guest');
    assert.equal(ctx.auth.user.telegramId, 777);
    assert.equal(ctx.auth.user.username, 'guestuser');
    assert.equal(ctx.session.isAuthenticated, false);
    assert.equal(ctx.session.authSnapshot.stale, true);
    assert.equal(ctx.session.authSnapshot.role, 'guest');
    assert.equal(ctx.session.user?.id, 777);
    assert.equal(ctx.session.user?.username, 'guestuser');
    assert.equal(replyCalled, false);
  });

  it('requires active subscriptions to have a future expiration date', async () => {
    const authRow = {
      tg_id: 654,
      username: 'expiringuser',
      first_name: 'Expired',
      last_name: 'User',
      phone: null,
      phone_verified: false,
      role: 'courier',
      is_verified: false,
      is_blocked: false,
      courier_verified: false,
      driver_verified: false,
      has_active_subscription: false,
    };

    const queries: string[] = [];
    setPoolQuery(async (...args) => {
      const [first] = args;
      let text = '';
      if (typeof first === 'string') {
        text = first;
      } else if (first && typeof first === 'object') {
        const config = first as { text?: string };
        text = config.text ?? '';
      }

      if (text) {
        queries.push(text);
      }

      if (text.includes('information_schema.columns')) {
        return { rows: [{ exists: false }] } as any;
      }

      return { rows: [authRow] } as any;
    });

    const middleware = auth();
    const session = createSessionState();
    const ctx = {
      from: { id: 654, username: 'expiringuser', first_name: 'Expired', last_name: 'User' },
      chat: { id: 555, type: 'private' as const },
      update: { message: { chat: { id: 555, type: 'private' as const } } },
      session,
      auth: undefined as any,
    } as unknown as BotContext;

    await middleware(ctx, async () => {});

    const subscriptionQuery = queries.find((text) =>
      text.includes('FROM channels c') && text.includes('JOIN subscriptions s'),
    );

    assert.ok(subscriptionQuery, 'subscription check query should be executed');
    assert.match(
      subscriptionQuery!,
      /COALESCE\(s\.grace_until, s\.next_billing_at\) > now\(\)/u,
    );
    assert.ok(
      !/COALESCE\(s\.grace_until, s\.next_billing_at\) IS NULL/u.test(subscriptionQuery!),
    );
  });
});

describe('bind command channel flow', () => {
  const channelCases = [
    {
      command: '/bind_verify_channel',
      chatId: -100987654,
      title: 'Freedom Announcements',
      username: 'freedom_announcements',
      expectedColumn: 'verify_channel_id',
      expectedMessage: /Готово! Канал верификации привязан к @freedom_announcements\./u,
    },
    {
      command: '/bind_drivers_channel',
      chatId: -100555666,
      title: 'Freedom Drivers',
      username: 'freedom_drivers',
      expectedColumn: 'drivers_channel_id',
      expectedMessage: /Готово! Канал исполнителей привязан к @freedom_drivers\./u,
    },
    {
      command: '/bind_stat_channel',
      chatId: -100999888,
      title: 'Freedom Reports',
      username: 'freedom_reports',
      expectedColumn: 'stats_channel_id',
      expectedMessage: /Готово! Канал отчётов привязан к @freedom_reports\./u,
    },
  ] as const;

  for (const {
    command,
    chatId,
    title,
    username,
    expectedColumn,
    expectedMessage,
  } of channelCases) {
    it(`saves bindings when ${command} is posted inside a channel`, async () => {
      const queries: Array<{ text: string; params?: ReadonlyArray<unknown> }> = [];
      const queryStub: QueryFunction = async (...args) => {
        const [firstArg, secondArg] = args;
        if (typeof firstArg === 'string') {
          queries.push({ text: firstArg, params: secondArg as ReadonlyArray<unknown> | undefined });
        } else if (firstArg && typeof firstArg === 'object' && 'text' in firstArg) {
          const config = firstArg as { text?: string; values?: ReadonlyArray<unknown> };
          queries.push({ text: config.text ?? '', params: config.values });
        }
        return { rows: [] } as any;
      };
      setPoolQuery(queryStub);

      const handleChannelPost = registerChannelPostHandler();
      const replies: string[] = [];
      const ctx = {
        chat: {
          id: chatId,
          type: 'channel' as const,
          title,
          username,
        },
        channelPost: {
          chat: {
            id: chatId,
            type: 'channel' as const,
            title,
            username,
          },
          text: command,
          entities: [{ type: 'bot_command', offset: 0, length: command.length }],
        },
        senderChat: {
          id: chatId,
          type: 'channel' as const,
          title,
          username,
        },
        update: { channel_post: { chat: { id: chatId, type: 'channel' as const } } },
        reply: async (text: string) => {
          replies.push(text);
          return { message_id: 42, text, chat: { id: chatId } };
        },
        session: createSessionState(),
        auth: undefined as any,
      } as unknown as BotContext;

      const middleware = auth();

      await middleware(ctx, async () => {
        await handleChannelPost(ctx, async () => {});
      });

      assert.equal(replies.length, 1);
      assert.match(replies[0], expectedMessage);

      assert.equal(queries.length, 1);
      assert.ok(queries[0].text.includes('INSERT INTO channels'));
      assert.ok(queries[0].text.includes(expectedColumn));
      assert.equal(queries[0].params?.[0], chatId);
    });
  }
});
