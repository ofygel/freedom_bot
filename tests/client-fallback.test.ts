import './helpers/setup-env';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type BotContext,
  type SupportSessionState,
} from '../src/bot/types';
import { registerClientFallback } from '../src/bot/flows/client/fallback';

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
    role: 'courier' as const,
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
  support: { status: 'idle' } as SupportSessionState,
});

const captureFallbackHandler = () => {
  let handler: ((ctx: BotContext, next?: () => Promise<void>) => Promise<void>) | undefined;
  const bot = {
    on: (event: string, cb: typeof handler) => {
      if (event === 'message') {
        handler = cb;
      }
      return bot;
    },
  } as any;

  registerClientFallback(bot);
  if (!handler) {
    throw new Error('Fallback handler was not registered');
  }
  return handler;
};

describe('client fallback', () => {
  it('shows the client menu when idle user sends text', async () => {
    const handler = captureFallbackHandler();
    const session = createSessionState();
    const replyCalls: string[] = [];

    const ctx = {
      chat: { id: 5001, type: 'private' as const },
      auth: {
        user: {
          telegramId: 3003,
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
      message: { message_id: 42, text: 'Привет' },
      reply: async (text: string) => {
        replyCalls.push(text);
        return { message_id: replyCalls.length, chat: { id: 5001 }, text };
      },
    } as unknown as BotContext;

    await handler(ctx);

    assert.equal(replyCalls.length, 1);
    assert.match(replyCalls[0], /меню/i);
  });

  it('defers to next handler when support request is active', async () => {
    const handler = captureFallbackHandler();
    const session = createSessionState();
    session.support.status = 'awaiting_message';
    const replyCalls: string[] = [];
    let nextCalled = 0;

    const ctx = {
      chat: { id: 5002, type: 'private' as const },
      auth: {
        user: {
          telegramId: 3004,
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
      message: { message_id: 43, text: 'Когда ответ?' },
      reply: async (text: string) => {
        replyCalls.push(text);
        return { message_id: replyCalls.length, chat: { id: 5002 }, text };
      },
    } as unknown as BotContext;

    await handler(ctx, async () => {
      nextCalled += 1;
    });

    assert.equal(replyCalls.length, 0);
    assert.equal(nextCalled, 1);
  });
});
