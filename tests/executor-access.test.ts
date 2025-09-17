import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';

import { EXECUTOR_VERIFICATION_PHOTO_COUNT, type BotContext, type SessionState } from '../src/bot/types';
import type { UiStepOptions } from '../src/bot/ui';

let ensureExecutorState: typeof import('../src/bot/flows/executor/menu')['ensureExecutorState'];
let showExecutorMenu: typeof import('../src/bot/flows/executor/menu')['showExecutorMenu'];
let startExecutorSubscription: typeof import('../src/bot/flows/executor/subscription')['startExecutorSubscription'];
let uiHelper: typeof import('../src/bot/ui')['ui'];

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

  ({ ensureExecutorState, showExecutorMenu } = await import('../src/bot/flows/executor/menu'));
  ({ startExecutorSubscription } = await import('../src/bot/flows/executor/subscription'));
  ({ ui: uiHelper } = await import('../src/bot/ui'));
});

const createSessionState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
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
});

const createAuthState = (telegramId = 700): BotContext['auth'] => ({
  user: {
    telegramId,
    username: undefined,
    firstName: undefined,
    lastName: undefined,
    phone: undefined,
    role: 'courier',
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

const createContext = () => {
  const session = createSessionState();
  const auth = createAuthState();

  const ctx = {
    chat: { id: 700, type: 'private' as const },
    from: { id: auth.user.telegramId },
    session,
    auth,
    answerCbQuery: async () => {},
    reply: async () => ({ message_id: 1, chat: { id: 700 }, text: '' }),
    telegram: {
      editMessageText: async () => true,
      deleteMessage: async () => true,
      copyMessage: async () => true,
    },
  } as unknown as BotContext;

  return { ctx, session, auth };
};

let originalStep: typeof uiHelper.step;
let recordedSteps: UiStepOptions[];

beforeEach(() => {
  recordedSteps = [];
  originalStep = uiHelper.step;
  (uiHelper as { step: typeof uiHelper.step }).step = async (_ctx, options) => {
    recordedSteps.push(options);
    return { messageId: recordedSteps.length, sent: true };
  };
});

afterEach(() => {
  (uiHelper as { step: typeof uiHelper.step }).step = originalStep;
});

describe('executor access control', () => {
  it('blocks subscription start when verification is missing', async () => {
    const { ctx } = createContext();
    ensureExecutorState(ctx);

    await startExecutorSubscription(ctx);

    const state = ctx.session.executor.subscription;
    assert.equal(state.status, 'idle');
    assert.equal(state.selectedPeriodId, undefined);
    const rejection = recordedSteps.find(
      (step) => step.id === 'executor:subscription:verification-required',
    );
    assert.ok(rejection, 'verification reminder should be shown');
  });

  it('renders the executor menu when verification and subscription are active', async () => {
    const { ctx } = createContext();
    ensureExecutorState(ctx);

    ctx.auth.executor.verifiedRoles.courier = true;
    ctx.auth.executor.isVerified = true;
    ctx.auth.executor.hasActiveSubscription = true;
    ctx.auth.user.isVerified = true;

    await showExecutorMenu(ctx);

    const menuStep = recordedSteps.find((step) => step.id === 'executor:menu:main');
    assert.ok(menuStep, 'executor menu should be displayed');
  });
});
