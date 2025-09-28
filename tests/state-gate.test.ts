import './helpers/setup-env';

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { stateGate } from '../src/bot/middlewares/stateGate';
import type { BotContext, SessionState } from '../src/bot/types';
import { onboardingKeyboard, removeKeyboard } from '../src/bot/ui/menus';

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

const createAuthState = (status: BotContext['auth']['user']['status']) => ({
  user: {
    telegramId: 100,
    role: 'courier' as const,
    status,
    isVerified: false,
    isBlocked: false,
    phone: '+7 (700) 000-00-00',
    phoneVerified: true,
  },
  executor: { verifiedRoles: { courier: false, driver: false }, hasActiveSubscription: false, isVerified: false },
  isModerator: false,
});

describe('stateGate middleware', () => {
  it('answers callback queries and stops suspended users', async () => {
    const middleware = stateGate();
    const answerCbQuery = mock.fn<
      (text: string, extra?: { show_alert?: boolean }) => Promise<void>
    >(async () => undefined);
    const reply = mock.fn<(text: string, extra?: unknown) => Promise<void>>(async () => undefined);

    const ctx = {
      chat: { id: 500, type: 'private' as const },
      update: { callback_query: { id: 'cbq-1', data: 'test' } },
      callbackQuery: { id: 'cbq-1', data: 'test' },
      answerCbQuery,
      reply,
      auth: createAuthState('suspended'),
      session: createSessionState(),
    } as unknown as BotContext;

    let nextCalled = false;
    await middleware(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, 'middleware should stop processing for suspended users');
    assert.equal(answerCbQuery.mock.callCount(), 1, 'callback query should be answered');
    const answerCall = answerCbQuery.mock.calls[0];
    assert.ok(answerCall, 'answerCbQuery should receive arguments');
    assert.equal(
      answerCall.arguments[0],
      'Доступ к функциям бота ограничен. Обратитесь в поддержку.',
      'should answer with restriction message',
    );
    assert.deepEqual(answerCall.arguments[1], { show_alert: false });

    assert.equal(reply.mock.callCount(), 1, 'suspended user should receive a direct reply');
    const replyCall = reply.mock.calls[0];
    assert.ok(replyCall, 'reply should receive arguments');
    assert.equal(
      replyCall.arguments[0],
      'Доступ к функциям бота ограничен. Обратитесь в поддержку.',
      'should send the same restriction message',
    );
    assert.deepEqual(replyCall.arguments[1], removeKeyboard());
  });

  it('avoids replying in channels when gating callbacks', async () => {
    const middleware = stateGate();
    const answerCbQuery = mock.fn<
      (text: string, extra?: { show_alert?: boolean }) => Promise<void>
    >(async () => undefined);
    const reply = mock.fn<(text: string, extra?: unknown) => Promise<void>>(async () => undefined);

    const ctx = {
      chat: { id: -100123, type: 'channel' as const },
      update: { callback_query: { id: 'cbq-2', data: 'noop' } },
      callbackQuery: { id: 'cbq-2', data: 'noop' },
      answerCbQuery,
      reply,
      auth: createAuthState('trial_expired'),
      session: createSessionState(),
    } as unknown as BotContext;

    let nextCalled = false;
    await middleware(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'middleware should ignore non-private chats');
    assert.equal(answerCbQuery.mock.callCount(), 0, 'callback query should not be answered');
    assert.equal(reply.mock.callCount(), 0, 'should not reply into channels for gated callbacks');
  });

  it('continues to reply for message updates', async () => {
    const middleware = stateGate();
    const answerCbQuery = mock.fn<
      (text: string, extra?: { show_alert?: boolean }) => Promise<void>
    >(async () => undefined);
    const reply = mock.fn<(text: string, extra?: unknown) => Promise<void>>(async () => undefined);

    const ctx = {
      chat: { id: 600, type: 'private' as const },
      message: { text: 'Привет' },
      reply,
      answerCbQuery,
      auth: {
        user: {
          telegramId: 200,
          role: 'courier' as const,
          status: 'awaiting_phone',
          isVerified: false,
          isBlocked: false,
          phone: undefined,
          phoneVerified: false,
        },
        executor: { verifiedRoles: { courier: false, driver: false }, hasActiveSubscription: false, isVerified: false },
        isModerator: false,
      },
      session: createSessionState(),
    } as unknown as BotContext;

    let nextCalled = false;
    await middleware(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, 'message updates should still be gated');
    assert.equal(answerCbQuery.mock.callCount(), 0, 'no callback query answer for message updates');
    assert.equal(reply.mock.callCount(), 1, 'should reply with onboarding prompt');
    const replyCall = reply.mock.calls[0];
    assert.ok(replyCall, 'reply should receive arguments');
    assert.equal(
      replyCall.arguments[0],
      'Чтобы продолжить, отправьте номер телефона через кнопку ниже.',
      'should send onboarding prompt',
    );
    assert.deepEqual(replyCall.arguments[1], onboardingKeyboard());
  });
});
