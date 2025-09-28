import '../helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import * as executorVerification from '../../src/bot/flows/executor/verification';
import type { BotContext, SessionState } from '../../src/bot/types';
import type { Message } from 'telegraf/typings/core/types/typegram';
import { EXECUTOR_VERIFICATION_PHOTO_COUNT } from '../../src/bot/types';
import { ui, type UiStepOptions } from '../../src/bot/ui';
import * as menuModule from '../../src/bot/flows/executor/menu';
import * as verificationsDb from '../../src/db/verifications';
import * as verifyQueue from '../../src/bot/moderation/verifyQueue';
import * as startModule from '../../src/bot/commands/start';
import * as clientMenu from '../../src/ui/clientMenu';
import * as phoneCollect from '../../src/bot/flows/common/phoneCollect';
import * as subscriptionModule from '../../src/bot/flows/executor/subscription';
import * as reportsModule from '../../src/bot/services/reports';
import { CLIENT_COMMANDS, EXECUTOR_COMMANDS } from '../../src/bot/commands/sets';
import * as paymentQueue from '../../src/bot/moderation/paymentQueue';

const DEFAULT_CITY = 'almaty' as const;

const createSessionState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
  city: DEFAULT_CITY,
  user: { id: 710, phoneVerified: true },
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
  const commandLog: import('telegraf/typings/core/types/typegram').BotCommand[][] = [];

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
      setMyCommands: async (
        commands: import('telegraf/typings/core/types/typegram').BotCommand[],
      ) => {
        commandLog.push(commands);
        return true;
      },
      setChatMenuButton: async () => true,
    },
    answerCbQuery: async () => {},
    reply: async () => ({ message_id: 2 }),
  } as unknown as BotContext;

  return { ctx, session, auth, commandLog };
};

const registerHandlers = () => {
  type Handler = (ctx: BotContext, next: () => Promise<void>) => Promise<void>;
  let mediaGroupHandler: Handler | undefined;
  const actionHandlers = new Map<
    string,
    (ctx: BotContext) => Promise<void>
  >();

  const bot = {
    action: (trigger: unknown, handler: unknown) => {
      if (typeof trigger === 'string') {
        actionHandlers.set(trigger, handler as (ctx: BotContext) => Promise<void>);
      }
      return bot;
    },
    on: (event: string, handler: unknown) => {
      if (event === 'media_group') {
        mediaGroupHandler = handler as Handler;
      }
      return bot;
    },
    command: () => bot,
    hears: () => bot,
  } as unknown as import('telegraf').Telegraf<BotContext>;

  executorVerification.registerExecutorVerification(bot);

  if (!mediaGroupHandler) {
    throw new Error('media group handler was not registered');
  }

  return {
    handleMediaGroup: mediaGroupHandler,
    getActionHandler: (action: string) => actionHandlers.get(action),
  };
};

const registerVerificationAndSubscriptionHandlers = () => {
  type Handler = (ctx: BotContext, next: () => Promise<void>) => Promise<void>;

  const photoHandlers: Handler[] = [];
  const mediaGroupHandlers: Handler[] = [];
  const unknownHandler = mock.fn<(ctx: BotContext) => Promise<void>>(async () => undefined);

  const bot = {
    action: () => bot,
    on: (event: string, handler: unknown) => {
      if (event === 'photo') {
        photoHandlers.push(handler as Handler);
      } else if (event === 'media_group') {
        mediaGroupHandlers.push(handler as Handler);
      }
      return bot;
    },
    command: () => bot,
    hears: () => bot,
  } as unknown as import('telegraf').Telegraf<BotContext>;

  executorVerification.registerExecutorVerification(bot);
  subscriptionModule.registerExecutorSubscription(bot);

  if (mediaGroupHandlers.length === 0) {
    throw new Error('media group handler was not registered');
  }

  const runHandlerChain = async (handlers: Handler[] | undefined, ctx: BotContext): Promise<void> => {
    if (!handlers || handlers.length === 0) {
      await unknownHandler(ctx);
      return;
    }

    const dispatch = async (index: number): Promise<void> => {
      if (index >= handlers.length) {
        await unknownHandler(ctx);
        return;
      }

      await handlers[index](ctx, async () => {
        await dispatch(index + 1);
      });
    };

    await dispatch(0);
  };

  return {
    runPhotoHandlers: (ctx: BotContext) => runHandlerChain(photoHandlers, ctx),
    runMediaGroupHandler: (ctx: BotContext) => runHandlerChain(mediaGroupHandlers, ctx),
    unknownHandler,
  };
};

describe('executor verification media group handler', () => {
  let recordedSteps: UiStepOptions[];
  let stepMock: ReturnType<typeof mock.method>;
  let showMenuMock: ReturnType<typeof mock.method>;
  let persistMock: ReturnType<typeof mock.method>;
  let publishMock: ReturnType<typeof mock.method>;
  let reportMock: ReturnType<typeof mock.method>;

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
    reportMock = mock.method(reportsModule, 'reportVerificationSubmitted', async () => undefined);
  });

  afterEach(() => {
    stepMock.mock.restore();
    showMenuMock.mock.restore();
    persistMock.mock.restore();
    publishMock.mock.restore();
    reportMock.mock.restore();
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
    assert.equal(reportMock.mock.callCount(), 1);
    assert.equal(
      reportMock.mock.calls[0]?.arguments[3],
      EXECUTOR_VERIFICATION_PHOTO_COUNT,
    );
  });

  it('waits for all media group updates before processing album photos', async () => {
    const { handleMediaGroup } = registerHandlers();
    const { ctx } = createContext();

    ctx.session.executor.verification.courier.status = 'collecting';

    const createAlbumMessage = (index: number): Message.PhotoMessage => ({
      message_id: 600 + index,
      chat: { id: ctx.chat!.id, type: 'private' as const, first_name: 'Tester' },
      date: Date.now(),
      media_group_id: 'album-split',
      photo: [
        { file_id: `photo-small-${index}`, file_unique_id: `unique-${index}`, width: 100, height: 100 },
        { file_id: `photo-best-${index}`, file_unique_id: `unique-${index}`, width: 1000, height: 1000 },
      ],
    });

    const firstMessage = createAlbumMessage(1);
    const secondMessage = createAlbumMessage(2);

    const firstCtx = { ...ctx } as BotContext;
    const secondCtx = { ...ctx } as BotContext;

    (firstCtx as unknown as { message: Message.PhotoMessage; update: { message: Message.PhotoMessage } }).message =
      firstMessage;
    (firstCtx as unknown as { update: { message: Message.PhotoMessage } }).update = { message: firstMessage };

    (secondCtx as unknown as { message: Message.PhotoMessage; update: { message: Message.PhotoMessage } }).message =
      secondMessage;
    (secondCtx as unknown as { update: { message: Message.PhotoMessage } }).update = { message: secondMessage };

    let firstNextCalled = false;
    const firstPromise = handleMediaGroup(firstCtx, async () => {
      firstNextCalled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    let secondNextCalled = false;
    const secondPromise = handleMediaGroup(secondCtx, async () => {
      secondNextCalled = true;
    });

    await Promise.all([firstPromise, secondPromise]);

    assert.equal(firstNextCalled, false);
    assert.equal(secondNextCalled, false);

    const verification = ctx.session.executor.verification.courier;
    assert.equal(verification.status, 'submitted');
    assert.equal(verification.uploadedPhotos.length, 0);

    const finalProgress = recordedSteps.find(
      (step) =>
        step.id === 'executor:verification:progress' &&
        step.text === `Фото ${EXECUTOR_VERIFICATION_PHOTO_COUNT}/${EXECUTOR_VERIFICATION_PHOTO_COUNT} получено.`,
    );

    assert.ok(finalProgress, 'final progress step should acknowledge full album');
    assert.equal(persistMock.mock.callCount(), 1);
    assert.equal(publishMock.mock.callCount(), 1);
    assert.equal(reportMock.mock.callCount(), 1);
    assert.equal(
      reportMock.mock.calls[0]?.arguments[3],
      EXECUTOR_VERIFICATION_PHOTO_COUNT,
    );
  });

  it('allows switching executor role during verification and shows role picker on next /start', async () => {
    const { getActionHandler } = registerHandlers();
    const { ctx, commandLog } = createContext();

    ctx.session.executor.verification.courier.status = 'collecting';
    ctx.session.executor.verification.courier.uploadedPhotos.push({
      fileId: 'file',
      fileUniqueId: 'unique',
      messageId: 401,
    });

    const presentRoleSelectionMock = mock.method(
      startModule,
      'presentRoleSelection',
      async () => undefined,
    );
    const hideMenuMock = mock.method(clientMenu, 'hideClientMenu', async () => undefined);
    const askPhoneMock = mock.method(phoneCollect, 'askPhone', async () => undefined);
    const startVerificationMock = mock.method(
      executorVerification,
      'startExecutorVerification',
      async () => undefined,
    );
    const startSubscriptionMock = mock.method(
      subscriptionModule,
      'startExecutorSubscription',
      async () => undefined,
    );

    const switchHandler = getActionHandler(executorVerification.EXECUTOR_ROLE_SWITCH_ACTION);
    if (!switchHandler) {
      throw new Error('switch role handler was not registered');
    }

    try {
      await switchHandler(ctx);

      assert.equal(ctx.session.executor.verification.courier.status, 'idle');
      assert.equal(presentRoleSelectionMock.mock.callCount(), 1);
      assert.equal(commandLog.length >= 1, true);
      assert.deepEqual(commandLog[0], CLIENT_COMMANDS);

      let startHandler: ((ctx: BotContext) => Promise<void>) | undefined;
      const startBot = {
        start: (handler: (ctx: BotContext) => Promise<void>) => {
          startHandler = handler;
          return startBot;
        },
        hears: () => startBot,
        on: () => startBot,
      } as unknown as import('telegraf').Telegraf<BotContext>;

      startModule.registerStartCommand(startBot);

      if (!startHandler) {
        throw new Error('start handler was not registered');
      }

      await startHandler(ctx);

      assert.equal(startVerificationMock.mock.callCount(), 0);
      assert.equal(startSubscriptionMock.mock.callCount(), 0);
      assert.equal(askPhoneMock.mock.callCount(), 0);
      assert.equal(hideMenuMock.mock.callCount(), 1);
      assert.equal(presentRoleSelectionMock.mock.callCount(), 2);
      assert.equal(commandLog.length >= 2, true);
      assert.deepEqual(commandLog[1], EXECUTOR_COMMANDS);
    } finally {
      presentRoleSelectionMock.mock.restore();
      hideMenuMock.mock.restore();
      askPhoneMock.mock.restore();
      startVerificationMock.mock.restore();
      startSubscriptionMock.mock.restore();
    }
  });
});

describe('executor verification and subscription integration', () => {
  let recordedSteps: UiStepOptions[];
  let stepMock: ReturnType<typeof mock.method>;
  let showMenuMock: ReturnType<typeof mock.method>;
  let persistMock: ReturnType<typeof mock.method>;
  let publishMock: ReturnType<typeof mock.method>;
  let reportVerificationMock: ReturnType<typeof mock.method>;
  let submitPaymentMock: ReturnType<typeof mock.method>;
  let reportPaymentMock: ReturnType<typeof mock.method>;

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
    reportVerificationMock = mock.method(reportsModule, 'reportVerificationSubmitted', async () => undefined);
    submitPaymentMock = mock.method(paymentQueue, 'submitSubscriptionPaymentReview', async () => ({
      status: 'published',
      chatId: 210,
      messageId: 220,
    }));
    reportPaymentMock = mock.method(reportsModule, 'reportSubscriptionPaymentSubmitted', async () => undefined);
  });

  afterEach(() => {
    stepMock.mock.restore();
    showMenuMock.mock.restore();
    persistMock.mock.restore();
    publishMock.mock.restore();
    reportVerificationMock.mock.restore();
    submitPaymentMock.mock.restore();
    reportPaymentMock.mock.restore();
  });

  it('handles executor albums without invoking the unknown fallback handler', async () => {
    const { runPhotoHandlers, runMediaGroupHandler, unknownHandler } =
      registerVerificationAndSubscriptionHandlers();
    const { ctx } = createContext();

    const createAlbumMessage = (index: number): Message.PhotoMessage => ({
      message_id: 800 + index,
      chat: { id: ctx.chat!.id, type: 'private' as const, first_name: 'Executor' },
      date: Date.now(),
      media_group_id: 'album-integration',
      photo: [
        {
          file_id: `photo-small-${index}`,
          file_unique_id: `unique-${index}`,
          width: 100,
          height: 100,
        },
        {
          file_id: `photo-best-${index}`,
          file_unique_id: `unique-${index}`,
          width: 1000,
          height: 1000,
        },
      ],
    });

    const album = [createAlbumMessage(1), createAlbumMessage(2)];
    const updates = album.map((message, index) => ({
      update_id: 900 + index,
      message,
    }));

    (ctx as unknown as { message: Message.PhotoMessage }).message = album[0];
    (ctx as unknown as { update: BotContext['update'] }).update = updates as unknown as BotContext['update'];

    await runPhotoHandlers(ctx);
    assert.equal(unknownHandler.mock.callCount(), 0);

    await runMediaGroupHandler(ctx);

    assert.equal(unknownHandler.mock.callCount(), 0);

    const verification = ctx.session.executor.verification.courier;
    assert.equal(verification.status, 'submitted');
    assert.equal(persistMock.mock.callCount(), 1);
    assert.equal(publishMock.mock.callCount(), 1);
    assert.equal(reportVerificationMock.mock.callCount(), 1);

    const progressStep = recordedSteps.find((step) => step.id === 'executor:verification:progress');
    assert.ok(progressStep, 'progress step should be shown for album uploads');
    const submittedStep = recordedSteps.find((step) => step.id === 'executor:verification:submitted');
    assert.ok(submittedStep, 'submitted step should be shown after album uploads');
  });

  it('delegates photo receipts to the subscription handler when awaitingReceipt', async () => {
    const { runPhotoHandlers, unknownHandler } = registerVerificationAndSubscriptionHandlers();
    const { ctx } = createContext();

    ctx.session.executor.subscription.status = 'awaitingReceipt';
    ctx.session.executor.subscription.selectedPeriodId = '7';

    const message: Message.PhotoMessage = {
      message_id: 950,
      chat: { id: ctx.chat!.id, type: 'private' as const, first_name: 'Executor' },
      date: Date.now(),
      photo: [
        { file_id: 'receipt-small', file_unique_id: 'receipt', width: 100, height: 100 },
        { file_id: 'receipt-best', file_unique_id: 'receipt', width: 1000, height: 1000 },
      ],
    };

    (ctx as unknown as { message: Message.PhotoMessage }).message = message;

    await runPhotoHandlers(ctx);

    assert.equal(unknownHandler.mock.callCount(), 0);
    assert.equal(persistMock.mock.callCount(), 0);
    assert.equal(publishMock.mock.callCount(), 0);
    assert.equal(reportVerificationMock.mock.callCount(), 0);
    assert.equal(submitPaymentMock.mock.callCount(), 1);
    assert.equal(reportPaymentMock.mock.callCount(), 1);
    assert.equal(ctx.session.executor.subscription.status, 'pendingModeration');

    const receiptStep = recordedSteps.find(
      (step) => step.id === 'executor:subscription:receipt-accepted',
    );
    assert.ok(receiptStep, 'receipt confirmation step should be shown');
  });
});
