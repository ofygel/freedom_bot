import './helpers/setup-env';

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type BotContext,
  type SessionState,
} from '../src/bot/types';

let uiHelper!: typeof import('../src/bot/ui')['ui'];

before(async () => {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test-token';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? 'postgres://user:pass@localhost:5432/db';
  process.env.CITY_DEFAULT = process.env.CITY_DEFAULT ?? 'Алматы';
  process.env.KASPI_CARD = process.env.KASPI_CARD ?? '4400 0000 0000 0000';
  process.env.KASPI_NAME = process.env.KASPI_NAME ?? 'Freedom Bot';
  process.env.KASPI_PHONE = process.env.KASPI_PHONE ?? '+7 (700) 000-00-00';
  process.env.DRIVERS_CHANNEL_INVITE =
    process.env.DRIVERS_CHANNEL_INVITE ?? 'https://t.me/+freedom-bot-drivers';
  process.env.SUB_PRICE_7 = process.env.SUB_PRICE_7 ?? '5000';
  process.env.SUB_PRICE_15 = process.env.SUB_PRICE_15 ?? '9000';
  process.env.SUB_PRICE_30 = process.env.SUB_PRICE_30 ?? '16000';

  ({ ui: uiHelper } = await import('../src/bot/ui'));
});

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
  ui: { steps: {}, homeActions: [] },
  support: { status: 'idle' },
});

const createAuthState = (): BotContext['auth'] => ({
  user: {
    telegramId: 42,
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

type EditHandler = (
  chatId: number,
  messageId: number,
  inlineMessageId: undefined,
  text: string,
  extra?: unknown,
) => Promise<unknown>;

const createMockContext = () => {
  const session = createSessionState();
  let nextMessageId = 1;
  const replyCalls: Array<{ text: string; extra?: unknown; messageId: number }> = [];
  const editCalls: Array<{ chatId: number; messageId: number; text: string; extra?: unknown }> = [];
  const deleteCalls: Array<{ chatId: number; messageId: number }> = [];

  let editOverride: EditHandler | undefined;

  const ctx = {
    chat: { id: 42, type: 'private' as const },
    from: { id: 42 },
    session,
    auth: createAuthState(),
    reply: async (text: string, extra?: unknown) => {
      const messageId = nextMessageId++;
      replyCalls.push({ text, extra, messageId });
      return { message_id: messageId, chat: { id: 42 }, text };
    },
    telegram: {
      editMessageText: async (
        chatId: number,
        messageId: number,
        inlineMessageId: undefined,
        text: string,
        extra?: unknown,
      ) => {
        editCalls.push({ chatId, messageId, text, extra });
        if (editOverride) {
          return editOverride(chatId, messageId, inlineMessageId, text, extra);
        }
        return true;
      },
      deleteMessage: async (chatId: number, messageId: number) => {
        deleteCalls.push({ chatId, messageId });
        return true;
      },
    },
  } as unknown as BotContext;

  const setEditHandler = (handler: EditHandler | undefined) => {
    editOverride = handler;
  };

  return { ctx, session, replyCalls, editCalls, deleteCalls, setEditHandler };
};

describe('ui helper', () => {
  it('sends and tracks steps, editing existing messages when possible', async () => {
    const { ctx, replyCalls, editCalls } = createMockContext();

    const initial = await uiHelper.step(ctx, {
      id: 'test:step',
      text: 'Initial step',
      cleanup: true,
    });
    assert.ok(initial?.sent);
    assert.equal(replyCalls.length, 1);
    assert.equal(ctx.session.ui.steps['test:step']?.cleanup, true);

    const updated = await uiHelper.step(ctx, {
      id: 'test:step',
      text: 'Updated step',
      cleanup: false,
    });
    assert.ok(updated);
    assert.equal(updated?.sent, false);
    assert.equal(replyCalls.length, 1);
    assert.equal(editCalls.length, 1);
    assert.equal(ctx.session.ui.steps['test:step']?.cleanup, false);
  });

  it('registers home actions when provided', async () => {
    const { ctx } = createMockContext();

    await uiHelper.step(ctx, { id: 'with-home', text: 'Menu', homeAction: 'home:test' });

    assert.deepEqual(ctx.session.ui.homeActions, ['home:test']);
  });

  it('handles "message is not modified" errors without duplicating messages', async () => {
    const { ctx, replyCalls, editCalls, setEditHandler } = createMockContext();

    await uiHelper.step(ctx, { id: 'unchanged', text: 'Same text', cleanup: true });

    setEditHandler(async () => {
      const error = new Error('Bad Request: message is not modified');
      (error as { description?: string }).description = 'Bad Request: message is not modified';
      throw error;
    });

    const result = await uiHelper.step(ctx, {
      id: 'unchanged',
      text: 'Same text',
      cleanup: true,
    });
    assert.ok(result);
    assert.equal(result?.sent, false);
    assert.equal(replyCalls.length, 1);
    assert.equal(editCalls.length, 1);
  });

  it('clears cleanup steps when navigating home', async () => {
    const { ctx, deleteCalls } = createMockContext();

    await uiHelper.step(ctx, { id: 'cleanup', text: 'Remove me', cleanup: true });
    await uiHelper.step(ctx, { id: 'keep', text: 'Keep me', cleanup: false });

    await uiHelper.clear(ctx);

    assert.equal(deleteCalls.length, 1);
    assert.ok(!ctx.session.ui.steps['cleanup']);
    assert.ok(ctx.session.ui.steps['keep']);
  });

  it('supports explicit clearing rules', async () => {
    const { ctx, deleteCalls } = createMockContext();

    await uiHelper.step(ctx, { id: 'first', text: 'First message', cleanup: false });
    await uiHelper.step(ctx, { id: 'second', text: 'Second message', cleanup: false });

    await uiHelper.clear(ctx, { cleanupOnly: false, ids: 'second' });

    assert.equal(deleteCalls.length, 1);
    assert.ok(ctx.session.ui.steps['first']);
    assert.ok(!ctx.session.ui.steps['second']);
  });
});
