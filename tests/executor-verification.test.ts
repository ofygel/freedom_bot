import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import type { BotContext, SessionState } from '../src/bot/types';
import { EXECUTOR_VERIFICATION_PHOTO_COUNT } from '../src/bot/types';
import type { UiStepOptions } from '../src/bot/ui';
import * as menuModule from '../src/bot/flows/executor/menu';
import { registerExecutorVerification, startExecutorVerification } from '../src/bot/flows/executor/verification';
import { ui } from '../src/bot/ui';

const DEFAULT_CITY = 'almaty' as const;

const createSessionState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
  city: DEFAULT_CITY,
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

const createAuthState = (telegramId = 710): BotContext['auth'] => ({
  user: {
    telegramId,
    username: undefined,
    firstName: undefined,
    lastName: undefined,
    phone: undefined,
    role: 'courier',
    isVerified: false,
    isBlocked: false,
    citySelected: DEFAULT_CITY,
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
    chat: { id: 710, type: 'private' as const },
    from: { id: auth.user.telegramId },
    session,
    auth,
    telegram: {
      editMessageText: async () => true,
      deleteMessage: async () => true,
      copyMessage: async () => true,
      sendMessage: async () => ({ message_id: 1 }),
    },
    answerCbQuery: async () => {},
  } as unknown as BotContext;

  return { ctx, session, auth };
};

type PhotoHandler = (ctx: BotContext, next: () => Promise<void>) => Promise<void>;

const registerVerificationHandlers = (): { handlePhoto: PhotoHandler } => {
  let photoHandler: PhotoHandler | undefined;

  const bot = {
    action: () => bot,
    on: (event: string, handler: unknown) => {
      if (event === 'photo') {
        photoHandler = handler as PhotoHandler;
      }
      return bot;
    },
    command: () => bot,
  } as unknown as import('telegraf').Telegraf<BotContext>;

  registerExecutorVerification(bot);

  if (!photoHandler) {
    throw new Error('photo handler was not registered');
  }

  return { handlePhoto: photoHandler };
};

describe('executor verification handlers', () => {
  let recordedSteps: UiStepOptions[];
  let stepMock: ReturnType<typeof mock.method>;
  let showMenuMock: ReturnType<typeof mock.method>;

  beforeEach(() => {
    recordedSteps = [];
    stepMock = mock.method(ui, 'step', async (_ctx: BotContext, options: UiStepOptions) => {
      recordedSteps.push(options);
      return { messageId: recordedSteps.length, sent: true };
    });
    showMenuMock = mock.method(menuModule, 'showExecutorMenu', async (_ctx: BotContext) => undefined);
  });

  afterEach(() => {
    stepMock.mock.restore();
    showMenuMock.mock.restore();
  });

  it('auto-starts verification when receiving the first photo', async () => {
    const { handlePhoto } = registerVerificationHandlers();
    const { ctx } = createContext();

    const message = {
      message_id: 201,
      chat: { id: ctx.chat!.id, type: 'private' as const },
      date: Date.now(),
      photo: [
        { file_id: 'photo-small', file_unique_id: 'ph-small', width: 100, height: 100 },
        { file_id: 'photo-best', file_unique_id: 'ph-best', width: 1000, height: 1000 },
      ],
    } as const;

    (ctx as unknown as { message: typeof message }).message = message;

    let nextCalled = false;
    await handlePhoto(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, 'photo handler should consume executor photos');

    const verification = ctx.session.executor.verification.courier;
    assert.equal(verification.status, 'collecting');
    assert.equal(verification.uploadedPhotos.length, 1);
    assert.equal(verification.uploadedPhotos[0]?.fileId, 'photo-best');

    const [promptStep, progressStep] = recordedSteps;
    assert.equal(promptStep?.id, 'executor:verification:prompt');
    assert.equal(progressStep?.id, 'executor:verification:progress');
    assert.equal(showMenuMock.mock.callCount(), 1);
  });

  it('reminds about submitted documents when verification is already on review', async () => {
    const { ctx } = createContext();
    ctx.session.executor.verification.courier.status = 'submitted';
    ctx.session.executor.verification.courier.uploadedPhotos = [
      { fileId: 'photo-1', messageId: 100 },
      { fileId: 'photo-2', messageId: 101 },
    ];

    await startExecutorVerification(ctx);

    const [statusStep] = recordedSteps;
    assert.equal(statusStep?.id, 'executor:verification:already-submitted');
    assert.equal(ctx.session.executor.verification.courier.status, 'submitted');
    assert.equal(showMenuMock.mock.callCount(), 0);
  });

  it('shows approval status when documents are already confirmed', async () => {
    const { ctx } = createContext();
    ctx.auth.executor.verifiedRoles.courier = true;
    ctx.auth.executor.isVerified = true;
    ctx.auth.user.isVerified = true;

    await startExecutorVerification(ctx);

    const [statusStep] = recordedSteps;
    assert.equal(statusStep?.id, 'executor:verification:approved');
    assert.equal(showMenuMock.mock.callCount(), 0);
  });
});
