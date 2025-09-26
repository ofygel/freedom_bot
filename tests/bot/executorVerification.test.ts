import '../helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { registerExecutorVerification } from '../../src/bot/flows/executor/verification';
import type { BotContext, SessionState } from '../../src/bot/types';
import type { Message } from 'telegraf/typings/core/types/typegram';
import { EXECUTOR_VERIFICATION_PHOTO_COUNT } from '../../src/bot/types';
import { ui, type UiStepOptions } from '../../src/bot/ui';
import * as menuModule from '../../src/bot/flows/executor/menu';
import * as verificationsDb from '../../src/db/verifications';
import * as verifyQueue from '../../src/bot/moderation/verifyQueue';

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
    phoneVerified: false,
    role: 'courier',
    status: 'active_executor',
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
      sendPhoto: async () => ({ message_id: 200 }),
      sendMessage: async () => ({ message_id: 1 }),
    },
    answerCbQuery: async () => {},
  } as unknown as BotContext;

  return { ctx, session, auth };
};

const registerHandlers = () => {
  type Handler = (ctx: BotContext, next: () => Promise<void>) => Promise<void>;
  let mediaGroupHandler: Handler | undefined;

  const bot = {
    action: () => bot,
    on: (event: string, handler: unknown) => {
      if (event === 'media_group') {
        mediaGroupHandler = handler as Handler;
      }
      return bot;
    },
    command: () => bot,
    hears: () => bot,
  } as unknown as import('telegraf').Telegraf<BotContext>;

  registerExecutorVerification(bot);

  if (!mediaGroupHandler) {
    throw new Error('media group handler was not registered');
  }

  return { handleMediaGroup: mediaGroupHandler };
};

describe('executor verification media group handler', () => {
  let recordedSteps: UiStepOptions[];
  let stepMock: ReturnType<typeof mock.method>;
  let showMenuMock: ReturnType<typeof mock.method>;
  let persistMock: ReturnType<typeof mock.method>;
  let publishMock: ReturnType<typeof mock.method>;

  beforeEach(() => {
    recordedSteps = [];
    stepMock = mock.method(ui, 'step', async (_ctx: BotContext, options: UiStepOptions) => {
      recordedSteps.push(options);
      return { messageId: recordedSteps.length, sent: true };
    });
    showMenuMock = mock.method(menuModule, 'showExecutorMenu', async (_ctx: BotContext) => undefined);
    persistMock = mock.method(verificationsDb, 'persistVerificationSubmission', async () => undefined);
    publishMock = mock.method(verifyQueue, 'publishVerificationApplication', async () => ({
      status: 'success',
      chatId: 1,
      messageId: 1,
      token: 'token',
    }));
  });

  afterEach(() => {
    stepMock.mock.restore();
    showMenuMock.mock.restore();
    persistMock.mock.restore();
    publishMock.mock.restore();
  });

  it('processes multiple photos within a single media group album', async () => {
    const { handleMediaGroup } = registerHandlers();
    const { ctx } = createContext();

    ctx.session.executor.verification.courier.status = 'collecting';

    const createAlbumMessage = (index: number): Message.PhotoMessage => ({
      message_id: 500 + index,
      chat: { id: ctx.chat!.id, type: 'private' as const, first_name: 'Tester' },
      date: Date.now(),
      media_group_id: 'album-1',
      photo: [
        { file_id: `photo-small-${index}`, file_unique_id: `unique-${index}`, width: 100, height: 100 },
        { file_id: `photo-best-${index}`, file_unique_id: `unique-${index}`, width: 1000, height: 1000 },
      ],
    });

    const album = [createAlbumMessage(1), createAlbumMessage(2)];
    const updates = album.map((message, index) => ({
      update_id: 800 + index,
      message,
    }));

    (ctx as unknown as { update: BotContext['update'] }).update = updates as unknown as BotContext['update'];
    (ctx as unknown as { message: Message.PhotoMessage }).message = album[0];

    let nextCalled = false;
    await handleMediaGroup(ctx, async () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);

    const verification = ctx.session.executor.verification.courier;
    assert.equal(verification.status, 'submitted');
    assert.equal(verification.uploadedPhotos.length, 0);
    const persistCall =
      persistMock.mock.calls[0]?.arguments[0] as Parameters<
        typeof verificationsDb.persistVerificationSubmission
      >[0];
    assert.equal(persistCall.photosUploaded, EXECUTOR_VERIFICATION_PHOTO_COUNT);
    assert.equal(persistMock.mock.callCount(), 1);
    assert.equal(publishMock.mock.callCount(), 1);
  });
});
