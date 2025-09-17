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

  it('authenticates user updates and populates ctx.auth', async () => {
    const authRow = {
      tg_id: 321,
      username: 'authuser',
      first_name: 'Auth',
      last_name: 'User',
      phone: '+7 700 000 00 00',
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
    assert.equal(ctx.session.user?.id, 321);
    assert.equal(ctx.session.phoneNumber, '+7 700 000 00 00');
  });
});

describe('bind command channel flow', () => {
  it('saves bindings when command is posted inside a channel', async () => {
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
        id: -100987654,
        type: 'channel' as const,
        title: 'Freedom Announcements',
        username: 'freedom_announcements',
      },
      channelPost: {
        chat: {
          id: -100987654,
          type: 'channel' as const,
          title: 'Freedom Announcements',
          username: 'freedom_announcements',
        },
        text: '/bind_verify_channel',
        entities: [{ type: 'bot_command', offset: 0, length: 20 }],
      },
      senderChat: {
        id: -100987654,
        type: 'channel' as const,
        title: 'Freedom Announcements',
        username: 'freedom_announcements',
      },
      update: { channel_post: { chat: { id: -100987654, type: 'channel' as const } } },
      reply: async (text: string) => {
        replies.push(text);
        return { message_id: 42, text, chat: { id: -100987654 } };
      },
      session: createSessionState(),
      auth: undefined as any,
    } as unknown as BotContext;

    const middleware = auth();

    await middleware(ctx, async () => {
      await handleChannelPost(ctx, async () => {});
    });

    assert.equal(replies.length, 1);
    assert.match(
      replies[0],
      /Готово! Канал верификации привязан к @freedom_announcements\./u,
    );

    assert.equal(queries.length, 1);
    assert.ok(queries[0].text.includes('INSERT INTO channels'));
    assert.equal(queries[0].params?.[0], -100987654);
  });
});
