import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { BotContext } from '../src/bot/types';
import { EXECUTOR_VERIFICATION_PHOTO_COUNT } from '../src/bot/types';
import { pool } from '../src/db';
import * as supportService from '../src/bot/services/support';
import { promptClientSupport, __testing__ as clientSupportTesting } from '../src/bot/flows/client/support';

const createSessionState = () => ({
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
      courier: {
        status: 'idle' as const,
        requiredPhotos: EXECUTOR_VERIFICATION_PHOTO_COUNT,
        uploadedPhotos: [],
      },
      driver: {
        status: 'idle' as const,
        requiredPhotos: EXECUTOR_VERIFICATION_PHOTO_COUNT,
        uploadedPhotos: [],
      },
    },
    subscription: { status: 'idle' as const },
  },
  client: {
    taxi: { stage: 'idle' as const },
    delivery: { stage: 'idle' as const },
  },
  ui: { steps: {}, homeActions: [] },
  support: { status: 'idle' as const },
});

const createContext = () => {
  const session = createSessionState();
  const replyCalls: Array<{ text: string; extra?: unknown }> = [];

  const ctx = {
    chat: { id: 1001, type: 'private' as const },
    from: { id: 2002, is_bot: false, first_name: 'Client' },
    auth: {
      user: {
        telegramId: 2002,
        username: undefined,
        firstName: 'Client',
        lastName: undefined,
        phone: undefined,
        phoneVerified: false,
        role: 'client' as const,
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
    },
    session,
    reply: async (text: string, extra?: unknown) => {
      replyCalls.push({ text, extra });
      return { message_id: replyCalls.length, chat: { id: 1001 }, text };
    },
    telegram: {
      setMyCommands: async () => undefined,
      setChatMenuButton: async () => undefined,
    },
  } as unknown as BotContext;

  return { ctx, replyCalls };
};

let forwardSupportMock: ReturnType<typeof mock.method> | undefined;
let poolQueryMock: ReturnType<typeof mock.method> | undefined;

afterEach(() => {
  forwardSupportMock?.mock.restore();
  poolQueryMock?.mock.restore();
  forwardSupportMock = undefined;
  poolQueryMock = undefined;
  supportService.__testing__?.setModerationChannelResolver(null);
  supportService.__testing__?.resetSupportState();
});

describe('client support flow', () => {
  it('prompts the user and switches to awaiting message state', async () => {
    const { ctx, replyCalls } = createContext();

    await promptClientSupport(ctx);

    assert.equal(ctx.session.support.status, 'awaiting_message');
    assert.equal(replyCalls.length, 1);
    assert.match(replyCalls[0].text, /Связаться с поддержкой/);
  });

  it('forwards a support message and returns to the menu', async () => {
    const { ctx, replyCalls } = createContext();
    ctx.session.support.status = 'awaiting_message';
    (ctx as any).message = { message_id: 10, text: 'Нужна помощь' };

    forwardSupportMock = mock.method(supportService, 'forwardSupportMessage', async () => ({
      status: 'forwarded' as const,
      threadId: 'thread-1',
    }));
    poolQueryMock = mock.method(pool, 'query', async () => ({ rows: [{ short_id: 'SUP-1' }] }) as any);

    const handled = await clientSupportTesting.handleSupportMessage(ctx);

    assert.equal(handled, true);
    assert.equal(ctx.session.support.status, 'idle');
    assert.equal(forwardSupportMock.mock.callCount(), 1);
    assert.equal(replyCalls.length, 1);
    assert.match(replyCalls[0].text, /Обращение отправлено/);
    assert.match(replyCalls[0].text, /SUP-1/);
  });

  it('notifies about unavailable support channel', async () => {
    const { ctx, replyCalls } = createContext();
    ctx.session.support.status = 'awaiting_message';
    (ctx as any).message = { message_id: 11, text: 'Алло' };

    forwardSupportMock = mock.method(supportService, 'forwardSupportMessage', async () => ({
      status: 'missing_channel' as const,
    }));

    const handled = await clientSupportTesting.handleSupportMessage(ctx);

    assert.equal(handled, true);
    assert.equal(ctx.session.support.status, 'idle');
    assert.equal(replyCalls.length, 1);
    assert.match(replyCalls[0].text, /не удалось передать/iu);
  });

  it('notifies client when moderation channel resolver throws', async () => {
    const { ctx, replyCalls } = createContext();
    ctx.session.support.status = 'awaiting_message';
    (ctx as any).message = { message_id: 13, text: 'Поддержка нужна' };

    supportService.__testing__.resetSupportState();
    supportService.__testing__.setModerationChannelResolver(async () => {
      throw new Error('db offline');
    });

    const handled = await clientSupportTesting.handleSupportMessage(ctx);

    assert.equal(handled, true);
    assert.equal(ctx.session.support.status, 'idle');
    assert.equal(replyCalls.length, 1);
    assert.match(replyCalls[0].text, /не удалось передать/iu);
  });

  it('asks to retry when forwarding fails', async () => {
    const { ctx, replyCalls } = createContext();
    ctx.session.support.status = 'awaiting_message';
    (ctx as any).message = { message_id: 12, text: 'Помогите' };

    forwardSupportMock = mock.method(supportService, 'forwardSupportMessage', async () => ({
      status: 'skipped' as const,
    }));

    const handled = await clientSupportTesting.handleSupportMessage(ctx);

    assert.equal(handled, true);
    assert.equal(ctx.session.support.status, 'awaiting_message');
    assert.equal(replyCalls.length, 1);
    assert.match(replyCalls[0].text, /Не удалось обработать сообщение/);
  });
});
