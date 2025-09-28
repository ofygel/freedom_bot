import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import type { BotContext, SessionState } from '../src/bot/types';
import type { Message } from 'telegraf/typings/core/types/typegram';
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
      sendMessage: async () => ({ message_id: 1 }),
    },
    answerCbQuery: async () => {},
  } as unknown as BotContext;

  return { ctx, session, auth };
};

type PhotoHandler = (ctx: BotContext, next: () => Promise<void>) => Promise<void>;
type MediaGroupHandler = PhotoHandler;

const registerVerificationHandlers = (): { handlePhoto: PhotoHandler; handleMediaGroup: MediaGroupHandler } => {
  let photoHandler: PhotoHandler | undefined;
  let mediaGroupHandler: MediaGroupHandler | undefined;

  const bot = {
    action: () => bot,
    on: (event: string, handler: unknown) => {
      if (event === 'photo') {
        photoHandler = handler as PhotoHandler;
      } else if (event === 'media_group') {
        mediaGroupHandler = handler as MediaGroupHandler;
      }
      return bot;
    },
    command: () => bot,
    hears: () => bot,
  } as unknown as import('telegraf').Telegraf<BotContext>;

  registerExecutorVerification(bot);

  if (!photoHandler) {
    throw new Error('photo handler was not registered');
  }

  if (!mediaGroupHandler) {
    throw new Error('media group handler was not registered');
  }

  return { handlePhoto: photoHandler, handleMediaGroup: mediaGroupHandler };
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

  it('ignores duplicate photos by unique id', async () => {
    const { handlePhoto } = registerVerificationHandlers();
    const { ctx } = createContext();

    const createMessage = (messageId: number) => ({
      message_id: messageId,
      chat: { id: ctx.chat!.id, type: 'private' as const },
      date: Date.now(),
      photo: [
        { file_id: 'photo-small', file_unique_id: 'ph-shared', width: 100, height: 100 },
        { file_id: `photo-best-${messageId}`, file_unique_id: 'ph-shared', width: 1000, height: 1000 },
      ],
    });

    const firstMessage = createMessage(301);
    (ctx as unknown as { message: typeof firstMessage; update: { message: typeof firstMessage } }).message =
      firstMessage;
    (ctx as unknown as { update: { message: typeof firstMessage } }).update = { message: firstMessage };

    await handlePhoto(ctx, async () => {});

    const secondMessage = createMessage(302);
    (ctx as unknown as { message: typeof secondMessage; update: { message: typeof secondMessage } }).message =
      secondMessage;
    (ctx as unknown as { update: { message: typeof secondMessage } }).update = { message: secondMessage };

    await handlePhoto(ctx, async () => {});

    const verification = ctx.session.executor.verification.courier;
    assert.equal(verification.uploadedPhotos.length, 1);
    assert.equal(verification.uploadedPhotos[0]?.fileUniqueId, 'ph-shared');
  });

  it('merges uploaded photos when two photo updates are processed in parallel', async () => {
    const { handlePhoto } = registerVerificationHandlers();
    const { ctx } = createContext();

    ctx.session.executor.verification.courier.status = 'collecting';
    ctx.session.executor.verification.courier.requiredPhotos = 5;

    const createMessage = (messageId: number) => ({
      message_id: messageId,
      chat: { id: ctx.chat!.id, type: 'private' as const },
      date: Date.now(),
      photo: [
        { file_id: `photo-small-${messageId}`, file_unique_id: `ph-${messageId}`, width: 100, height: 100 },
        { file_id: `photo-best-${messageId}`, file_unique_id: `ph-${messageId}`, width: 1000, height: 1000 },
      ],
    });

    const firstMessage = createMessage(401);
    const secondMessage = createMessage(402);

    const firstCtx = { ...ctx } as BotContext;
    const secondCtx = { ...ctx } as BotContext;

    (firstCtx as unknown as { message: typeof firstMessage; update: { message: typeof firstMessage } }).message =
      firstMessage;
    (firstCtx as unknown as { update: { message: typeof firstMessage } }).update = { message: firstMessage };

    (secondCtx as unknown as { message: typeof secondMessage; update: { message: typeof secondMessage } }).message =
      secondMessage;
    (secondCtx as unknown as { update: { message: typeof secondMessage } }).update = { message: secondMessage };

    await Promise.all([handlePhoto(firstCtx, async () => {}), handlePhoto(secondCtx, async () => {})]);

    const uploaded = ctx.session.executor.verification.courier.uploadedPhotos;
    assert.equal(uploaded.length, 2);
    assert.deepEqual(
      uploaded.map((photo) => photo.messageId).sort((a, b) => a - b),
      [401, 402],
    );
  });

  it('merges uploaded photos when media group albums extend existing state', async () => {
    const { handleMediaGroup } = registerVerificationHandlers();
    const { ctx } = createContext();

    ctx.session.executor.verification.courier.status = 'collecting';
    ctx.session.executor.verification.courier.requiredPhotos = 5;
    ctx.session.executor.verification.courier.uploadedPhotos = [
      { fileId: 'existing-photo', messageId: 350, fileUniqueId: 'existing-unique' },
    ];

    const createAlbumMessage = (index: number): Message.PhotoMessage => ({
      message_id: 500 + index,
      chat: { id: ctx.chat!.id, type: 'private' as const, first_name: 'Tester' },
      date: Date.now(),
      media_group_id: 'album-merge',
      photo: [
        { file_id: `photo-small-${index}`, file_unique_id: `unique-${index}`, width: 100, height: 100 },
        { file_id: `photo-best-${index}`, file_unique_id: `unique-${index}`, width: 1000, height: 1000 },
      ],
    });

    const album = [createAlbumMessage(1), createAlbumMessage(2)];
    const updates = album.map((message, index) => ({
      update_id: 900 + index,
      message,
    }));

    (ctx as unknown as { update: BotContext['update'] }).update = updates as unknown as BotContext['update'];
    (ctx as unknown as { message: Message.PhotoMessage }).message = album[0];

    await handleMediaGroup(ctx, async () => {});

    const uploaded = ctx.session.executor.verification.courier.uploadedPhotos;
    assert.equal(uploaded.length, 3);
    assert.deepEqual(
      uploaded.map((photo) => photo.messageId).sort((a, b) => a - b),
      [350, 501, 502],
    );
  });
});
