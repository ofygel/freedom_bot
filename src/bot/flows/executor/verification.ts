import { Markup } from 'telegraf';
import type { Telegraf } from 'telegraf';
import { TelegramError } from 'telegraf';
import type { Message } from 'telegraf/typings/core/types/typegram';

import { logger } from '../../../config';
import {
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type BotContext,
  type ExecutorFlowState,
  type ExecutorRole,
} from '../../types';
import { persistVerificationSubmission } from '../../../db/verifications';
import {
  EXECUTOR_MENU_ACTION,
  EXECUTOR_MENU_TEXT_LABELS,
  EXECUTOR_SUBSCRIPTION_ACTION,
  EXECUTOR_VERIFICATION_ACTION,
  ensureExecutorState,
  isExecutorRoleVerified,
  isExecutorMenuTextCommand,
  requireExecutorRole,
  resetVerificationState,
  showExecutorMenu,
} from './menu';
import { presentRoleSelection } from '../../commands/start';
import { publishVerificationApplication, type VerificationApplication } from '../../moderation/verifyQueue';
import { getExecutorRoleCopy } from '../../copy';
import { ui } from '../../ui';
import { reportVerificationSubmitted, type UserIdentity } from '../../services/reports';
import { setChatCommands } from '../../services/commands';
import { CLIENT_COMMANDS } from '../../commands/sets';

const ROLE_PROMPTS: Record<ExecutorRole, string[]> = {
  courier: [
    `Для доступа к заказам курьера отправьте ${EXECUTOR_VERIFICATION_PHOTO_COUNT} фотографии документов:`,
    '1. Фото удостоверения личности (лицевая сторона).',
    '2. Фото удостоверения личности (оборотная сторона).',
  ],
  driver: [
    `Для доступа к заказам водителя отправьте ${EXECUTOR_VERIFICATION_PHOTO_COUNT} фотографии документов:`,
    '1. Фото водительского удостоверения (лицевая сторона).',
    '2. Селфи с водительским удостоверением в руках.',
  ],
};

const ROLE_VERIFICATION_GUIDANCE: Record<
  ExecutorRole,
  {
    idlePrompt: string;
    collectingPrompt: string;
    nextStepsPrompt: string;
  }
> = {
  courier: {
    idlePrompt:
      'Отправьте фото удостоверения личности (лицевая и оборотная стороны) в этот чат.',
    collectingPrompt:
      'Пришлите оставшиеся фото удостоверения личности: нужны и лицевая, и оборотная стороны.',
    nextStepsPrompt: '📸 Отправьте фото удостоверения личности с обеих сторон в этот чат.',
  },
  driver: {
    idlePrompt:
      'Отправьте фото водительского удостоверения (лицевая сторона) и селфи с удостоверением в руках в этот чат.',
    collectingPrompt:
      'Пришлите оставшиеся фото: водительское удостоверение (лицевая сторона) и селфи с ним.',
    nextStepsPrompt:
      '📸 Отправьте фото водительского удостоверения (лицевая сторона) и селфи с ним в этот чат.',
  },
};

export const VERIFICATION_ALBUM_HINT =
  'Можно отправить оба фото одним альбомом или отдельными сообщениями в этот чат.';

type VerificationRoleGuidance = (typeof ROLE_VERIFICATION_GUIDANCE)[ExecutorRole];

export const getVerificationRoleGuidance = (
  role: ExecutorRole,
): VerificationRoleGuidance =>
  ROLE_VERIFICATION_GUIDANCE[role] ?? ROLE_VERIFICATION_GUIDANCE.courier;

const buildVerificationPrompt = (role: ExecutorRole): string => {
  const lines = ROLE_PROMPTS[role] ?? ROLE_PROMPTS.courier;
  return [...lines, '', VERIFICATION_ALBUM_HINT].join('\n');
};

const VERIFICATION_CHANNEL_MISSING_STEP_ID = 'executor:verification:channel-missing';
const VERIFICATION_SUBMISSION_FAILED_STEP_ID = 'executor:verification:submission-failed';
const VERIFICATION_SUBMITTED_STEP_ID = 'executor:verification:submitted';
const VERIFICATION_ALREADY_SUBMITTED_STEP_ID = 'executor:verification:already-submitted';
const VERIFICATION_PROMPT_STEP_ID = 'executor:verification:prompt';
const VERIFICATION_ALREADY_ON_REVIEW_STEP_ID = 'executor:verification:on-review';
const VERIFICATION_START_REMINDER_STEP_ID = 'executor:verification:start-reminder';
const VERIFICATION_PROGRESS_STEP_ID = 'executor:verification:progress';
const VERIFICATION_PHOTO_REMINDER_STEP_ID = 'executor:verification:photo-reminder';
const VERIFICATION_ALREADY_APPROVED_STEP_ID = 'executor:verification:approved';
export const EXECUTOR_ROLE_SWITCH_ACTION = 'executor:verification:switch-role';

const buildSubscriptionShortcutKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('📨 Получить ссылку на канал', EXECUTOR_SUBSCRIPTION_ACTION)],
  ]).reply_markup;

const buildVerificationPromptKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('↩️ Сменить роль', EXECUTOR_ROLE_SWITCH_ACTION)],
  ]).reply_markup;

const buildVerificationApprovedText = (
  copy: ReturnType<typeof getExecutorRoleCopy>,
): string =>
  [
    '✅ Документы подтверждены.',
    `Чтобы получить доступ к заказам ${copy.genitive}, оформите подписку и запросите ссылку через кнопку ниже.`,
    'Если потребуется помощь, напишите в поддержку.',
  ].join('\n');

const submitForModeration = async (
  ctx: BotContext,
  state: ExecutorFlowState,
): Promise<boolean> => {
  const applicantId = ctx.auth?.user.telegramId ?? ctx.from?.id;
  if (applicantId === undefined) {
    logger.error(
      { chatId: ctx.chat?.id, role: state.role },
      'Cannot submit verification without applicant id',
    );
    await ui.step(ctx, {
      id: VERIFICATION_SUBMISSION_FAILED_STEP_ID,
      text: 'Не удалось отправить документы на проверку. Попробуйте позже.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return false;
  }

  const role = state.role;
  if (!role) {
    logger.error(
      { chatId: ctx.chat?.id },
      'Cannot submit verification without executor role',
    );
    await ui.step(ctx, {
      id: VERIFICATION_SUBMISSION_FAILED_STEP_ID,
      text: 'Не удалось отправить документы на проверку. Попробуйте позже.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return false;
  }
  const verification = state.verification[role];
  const copy = getExecutorRoleCopy(role);
  const submittedAt = Date.now();
  const applicationId = `${applicantId.toString(10)}:${submittedAt.toString(10)}`;
  const summaryLines = [`Роль: ${copy.noun} (${role})`];

  const application: VerificationApplication = {
    id: applicationId,
    title: `🆕 Новая заявка на верификацию ${copy.genitive}.`,
    role,
    summary: summaryLines,
    applicant: {
      telegramId: applicantId,
      username: ctx.auth.user.username ?? ctx.from?.username ?? undefined,
      firstName: ctx.auth.user.firstName ?? ctx.from?.first_name ?? undefined,
      lastName: ctx.auth.user.lastName ?? ctx.from?.last_name ?? undefined,
      phone: ctx.auth.user.phone ?? ctx.session.phoneNumber ?? undefined,
    },
    photoCount: verification.uploadedPhotos.length,
    submittedAt,
    sessionContext: {
      scope: 'chat',
      scopeId: applicantId.toString(10),
      role,
      applicationId,
    },
  };

  try {
    await persistVerificationSubmission({
      applicant: application.applicant,
      role,
      photosRequired: verification.requiredPhotos,
      photosUploaded: verification.uploadedPhotos.length,
    });
  } catch (error) {
    logger.error(
      { err: error, applicationId, role, applicantId },
      'Failed to persist executor verification submission',
    );
    await ui.step(ctx, {
      id: VERIFICATION_SUBMISSION_FAILED_STEP_ID,
      text: 'Не удалось отправить документы на проверку. Попробуйте позже.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return false;
  }

  try {
    const result = await publishVerificationApplication(ctx.telegram, application);

    if (result.status === 'missing_channel') {
      await ui.step(ctx, {
        id: VERIFICATION_CHANNEL_MISSING_STEP_ID,
        text: 'Канал верификации пока не настроен. Попробуйте позже.',
        cleanup: true,
        homeAction: EXECUTOR_MENU_ACTION,
      });
      return false;
    }

    verification.status = 'submitted';
    verification.submittedAt = submittedAt;
    verification.moderation = {
      applicationId,
      chatId: result.chatId,
      messageId: result.messageId,
      token: result.token,
    };

    const moderationChatId = result.chatId;
    const storedPhotos = [...verification.uploadedPhotos];
    const submittedPhotoCount = storedPhotos.length;

    if (storedPhotos.length > 0) {
      if (typeof moderationChatId !== 'number') {
        logger.warn(
          { applicationId, role, applicantId, moderationChatId },
          'Cannot forward verification photos without moderation chat id',
        );
      } else {
        const baseAnnotationLines = [
          `📎 Фотографии документов для заявки ${applicationId}.`,
        ];

        const applicant = application.applicant;

        if (applicant.username) {
          baseAnnotationLines.push(`Пользователь: @${applicant.username}`);
        }

        const fullName = [applicant.firstName, applicant.lastName]
          .map((value) => value?.trim())
          .filter(Boolean)
          .join(' ')
          .trim();

        if (fullName) {
          baseAnnotationLines.push(`Имя: ${fullName}`);
        }

        baseAnnotationLines.push(`Роль: ${copy.noun} (${role}).`);

        const failedPhotos: typeof verification.uploadedPhotos = [];
        let forwardedCount = 0;

        for (const [index, photo] of storedPhotos.entries()) {
          const caption = index === 0 ? baseAnnotationLines.join('\n') : undefined;

          try {
            await ctx.telegram.sendPhoto(
              moderationChatId,
              photo.fileId,
              caption ? { caption } : undefined,
            );
            forwardedCount += 1;
          } catch (error) {
            failedPhotos.push(photo);

            if (error instanceof TelegramError) {
              logger.error(
                {
                  err: error,
                  applicationId,
                  role,
                  applicantId,
                  moderationChatId,
                  fileId: photo.fileId,
                },
                'Failed to send verification photo to moderation chat',
              );
              continue;
            }

            logger.error(
              {
                err: error,
                applicationId,
                role,
                applicantId,
                moderationChatId,
                fileId: photo.fileId,
              },
              'Unexpected error while sending verification photo to moderation chat',
            );
          }
        }

        if (forwardedCount > 0) {
          const annotationLines = [...baseAnnotationLines];

          if (failedPhotos.length > 0) {
            annotationLines.push(
              `⚠️ Не удалось отправить ${failedPhotos.length} из ${storedPhotos.length} фото, они останутся в заявке для повторной отправки.`,
            );
          }

          try {
            await ctx.telegram.sendMessage(moderationChatId, annotationLines.join('\n'));
          } catch (error) {
            logger.error(
              { err: error, applicationId, role, moderationChatId },
              'Failed to send verification photo annotation to moderation chat',
            );
          }
        }

        verification.uploadedPhotos = failedPhotos;
      }
    }

    const applicant: UserIdentity = {
      telegramId: application.applicant.telegramId,
      username: application.applicant.username,
      firstName: application.applicant.firstName,
      lastName: application.applicant.lastName,
      phone: application.applicant.phone,
    };

    await reportVerificationSubmitted(
      ctx.telegram,
      applicant,
      role,
      submittedPhotoCount,
      application.applicant.phone,
    );

    await ui.step(ctx, {
      id: VERIFICATION_SUBMITTED_STEP_ID,
      text: 'Спасибо! Мы получили ваши документы и передали их модераторам. Ожидайте решения.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });

    return true;
  } catch (error) {
    logger.error(
      { err: error, applicationId, role },
      'Failed to submit executor verification to moderation queue',
    );
    await ui.step(ctx, {
      id: VERIFICATION_SUBMISSION_FAILED_STEP_ID,
      text: 'Не удалось отправить документы на проверку. Попробуйте позже.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return false;
  }
};

export const startExecutorVerification = async (
  ctx: BotContext,
): Promise<void> => {
  ensureExecutorState(ctx);
  const state = ctx.session.executor;
  const role = state.role;
  if (!role) {
    return;
  }
  const verification = state.verification[role];
  const alreadyVerified = isExecutorRoleVerified(ctx, role);
  const copy = getExecutorRoleCopy(role);

  if (alreadyVerified) {
    await ui.step(ctx, {
      id: VERIFICATION_ALREADY_APPROVED_STEP_ID,
      text: buildVerificationApprovedText(copy),
      keyboard: buildSubscriptionShortcutKeyboard(),
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return;
  }

  if (verification.status === 'submitted') {
    await ui.step(ctx, {
      id: VERIFICATION_ALREADY_SUBMITTED_STEP_ID,
      text: 'Мы уже отправили ваши документы на проверку. Ожидайте решения.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return;
  }

  resetVerificationState(state);
  state.verification[role].status = 'collecting';

  const promptText = buildVerificationPrompt(role);
  await ui.step(ctx, {
    id: VERIFICATION_PROMPT_STEP_ID,
    text: promptText,
    keyboard: buildVerificationPromptKeyboard(),
    cleanup: true,
    homeAction: EXECUTOR_MENU_ACTION,
  });

  await showExecutorMenu(ctx, { skipAccessCheck: true });
};

const handleIncomingPhoto = async (
  ctx: BotContext,
  photoMessage?: Message.PhotoMessage,
): Promise<boolean> => {
  if (ctx.chat?.type !== 'private') {
    return false;
  }

  const state = ensureExecutorState(ctx);

  if (state.subscription.status === 'awaitingReceipt' || state.subscription.status === 'pendingModeration') {
    return false;
  }

  const role = state.role;
  if (!role) {
    return false;
  }
  let verification = state.verification[role];
  const copy = getExecutorRoleCopy(role);
  const alreadyVerified = isExecutorRoleVerified(ctx, role);

  if (alreadyVerified) {
    await ui.step(ctx, {
      id: VERIFICATION_ALREADY_APPROVED_STEP_ID,
      text: buildVerificationApprovedText(copy),
      keyboard: buildSubscriptionShortcutKeyboard(),
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return true;
  }

  const message = photoMessage ?? ctx.message;
  if (!message || !('photo' in message) || !Array.isArray(message.photo) || message.photo.length === 0) {
    return false;
  }

  if (verification.status === 'submitted') {
    await ui.step(ctx, {
      id: VERIFICATION_ALREADY_ON_REVIEW_STEP_ID,
      text: 'Документы уже на проверке. Мы свяжемся с вами после решения модераторов.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return true;
  }

  if (verification.status === 'idle') {
    const hasConflicts =
      verification.uploadedPhotos.length > 0 ||
      typeof verification.submittedAt === 'number' ||
      Boolean(verification.moderation);

    if (hasConflicts) {
      await ui.step(ctx, {
        id: VERIFICATION_START_REMINDER_STEP_ID,
        text: `Начните проверку через меню ${copy.genitive}, чтобы отправить документы.`,
        cleanup: true,
        homeAction: EXECUTOR_MENU_ACTION,
      });
      return true;
    }

    resetVerificationState(state);
    verification = state.verification[role];
    verification.status = 'collecting';

    const promptText = buildVerificationPrompt(role);
    await ui.step(ctx, {
      id: VERIFICATION_PROMPT_STEP_ID,
      text: promptText,
      keyboard: buildVerificationPromptKeyboard(),
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
  } else if (verification.status !== 'collecting') {
    await ui.step(ctx, {
      id: VERIFICATION_START_REMINDER_STEP_ID,
      text: `Начните проверку через меню ${copy.genitive}, чтобы отправить документы.`,
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return true;
  }

  const photoSizes = message.photo;
  const bestPhoto = photoSizes[photoSizes.length - 1];
  const bestPhotoUniqueId = bestPhoto.file_unique_id;
  const initialPhotos = verification.uploadedPhotos;
  const uploadedBefore = initialPhotos.length;
  const messageId = message.message_id;

  const isDuplicate = (): boolean => {
    const currentPhotos = verification.uploadedPhotos;
    const duplicateByUniqueId =
      typeof bestPhotoUniqueId === 'string' &&
      currentPhotos.some((photo) => photo.fileUniqueId === bestPhotoUniqueId);
    if (duplicateByUniqueId) {
      return true;
    }

    return currentPhotos.some((photo) => photo.messageId === messageId);
  };

  if (isDuplicate()) {
    await ui.step(ctx, {
      id: VERIFICATION_PROGRESS_STEP_ID,
      text: `Фото ${uploadedBefore}/${verification.requiredPhotos} получено.`,
      cleanup: true,
    });
    await showExecutorMenu(ctx, { skipAccessCheck: true });
    return true;
  }

  if (verification.uploadedPhotos !== initialPhotos && isDuplicate()) {
    await ui.step(ctx, {
      id: VERIFICATION_PROGRESS_STEP_ID,
      text: `Фото ${uploadedBefore}/${verification.requiredPhotos} получено.`,
      cleanup: true,
    });
    await showExecutorMenu(ctx, { skipAccessCheck: true });
    return true;
  }

  const updatedPhotos = [...verification.uploadedPhotos, {
    fileId: bestPhoto.file_id,
    messageId,
    fileUniqueId: bestPhotoUniqueId,
  }];

  updatedPhotos.sort((left, right) => left.messageId - right.messageId);
  verification.uploadedPhotos = updatedPhotos;

  const uploaded = verification.uploadedPhotos.length;
  const required = verification.requiredPhotos;
  await ui.step(ctx, {
    id: VERIFICATION_PROGRESS_STEP_ID,
    text: `Фото ${uploaded}/${required} получено.`,
    cleanup: true,
  });

  if (uploaded >= required) {
    await submitForModeration(ctx, state);
    await showExecutorMenu(ctx, { skipAccessCheck: true });
    return true;
  }

  await showExecutorMenu(ctx, { skipAccessCheck: true });
  return true;
};

const handleTextDuringCollection = async (ctx: BotContext, next: () => Promise<void>): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    await next();
    return;
  }

  const state = ensureExecutorState(ctx);
  const role = state.role;
  if (!role) {
    await next();
    return;
  }
  const verification = state.verification[role];
  if (verification.status !== 'collecting') {
    await next();
    return;
  }

  const telegramMessage = ctx.message;
  if (!telegramMessage || !('text' in telegramMessage)) {
    await next();
    return;
  }

  const text = telegramMessage.text;
  if (text.trim().startsWith('/')) {
    await next();
    return;
  }

  if (isExecutorMenuTextCommand(text.trim())) {
    await next();
    return;
  }

  await ui.step(ctx, {
    id: VERIFICATION_PHOTO_REMINDER_STEP_ID,
    text: 'Отправьте, пожалуйста, фотографию документа.',
    cleanup: true,
  });
};

const collectMediaGroupPhotos = (
  update: unknown,
  mediaGroupId?: string,
): Message.PhotoMessage[] => {
  if (!update) {
    return [];
  }

  const stack: unknown[] = [update];
  const found: Message.PhotoMessage[] = [];
  const seenMessageIds = new Set<number>();

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current) {
      continue;
    }

    if (Array.isArray(current)) {
      for (const value of current) {
        stack.push(value);
      }
      continue;
    }

    if (typeof current !== 'object') {
      continue;
    }

    if (
      'media_group_id' in current &&
      typeof (current as { media_group_id?: unknown }).media_group_id === 'string' &&
      'photo' in current &&
      Array.isArray((current as { photo?: unknown }).photo)
    ) {
      const message = current as Message.PhotoMessage;

      if (!mediaGroupId || message.media_group_id === mediaGroupId) {
        const messageId = message.message_id;

        if (!seenMessageIds.has(messageId)) {
          seenMessageIds.add(messageId);
          found.push(message);
        }
      }
    }

    for (const value of Object.values(current)) {
      if (value && (typeof value === 'object' || Array.isArray(value))) {
        stack.push(value);
      }
    }
  }

  return found;
};

const MEDIA_GROUP_FLUSH_DELAY_MS = 200;

interface PendingMediaGroupResult {
  ownerMessageId: number;
  messages: Message.PhotoMessage[];
}

interface PendingMediaGroup {
  ownerMessageId: number;
  messages: Map<number, Message.PhotoMessage>;
  promise: Promise<PendingMediaGroupResult>;
  resolve?: (value: PendingMediaGroupResult) => void;
  timeout?: NodeJS.Timeout;
}

const pendingMediaGroups = new Map<string, PendingMediaGroup>();

const buildMediaGroupKey = (ctx: BotContext, mediaGroupId: string): string | undefined => {
  const scopeId = ctx.chat?.id ?? ctx.from?.id;

  if (scopeId === undefined || scopeId === null) {
    return undefined;
  }

  if (
    typeof scopeId === 'string' ||
    typeof scopeId === 'number' ||
    typeof scopeId === 'bigint'
  ) {
    return `${String(scopeId)}:${mediaGroupId}`;
  }

  return undefined;
};

const ensurePendingMediaGroup = (
  key: string,
  ownerMessageId: number,
): PendingMediaGroup => {
  let entry = pendingMediaGroups.get(key);
  if (!entry) {
    let resolve: ((value: PendingMediaGroupResult) => void) | undefined;
    const promise = new Promise<PendingMediaGroupResult>((resolveFn) => {
      resolve = resolveFn;
    });

    entry = {
      ownerMessageId,
      messages: new Map<number, Message.PhotoMessage>(),
      promise,
      resolve,
    } satisfies PendingMediaGroup;

    pendingMediaGroups.set(key, entry);
  }

  return entry;
};

const registerPendingMediaGroupMessage = (
  entry: PendingMediaGroup,
  message: Message.PhotoMessage,
): void => {
  entry.messages.set(message.message_id, message);
};

const resolvePendingMediaGroup = (key: string, entry: PendingMediaGroup): void => {
  if (entry.timeout) {
    clearTimeout(entry.timeout);
    entry.timeout = undefined;
  }

  pendingMediaGroups.delete(key);

  const payload: PendingMediaGroupResult = {
    ownerMessageId: entry.ownerMessageId,
    messages: [...entry.messages.values()].sort(
      (left, right) => left.message_id - right.message_id,
    ),
  };

  entry.resolve?.(payload);
};

const schedulePendingMediaGroupFlush = (key: string, entry: PendingMediaGroup): void => {
  if (entry.timeout) {
    clearTimeout(entry.timeout);
  }

  entry.timeout = setTimeout(() => {
    resolvePendingMediaGroup(key, entry);
  }, MEDIA_GROUP_FLUSH_DELAY_MS);
};

export const registerExecutorVerification = (bot: Telegraf<BotContext>): void => {
  bot.action(EXECUTOR_VERIFICATION_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCbQuery('Доступно только в личных сообщениях.');
      return;
    }

    await ctx.answerCbQuery();
    await startExecutorVerification(ctx);
  });

  bot.action(EXECUTOR_ROLE_SWITCH_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCbQuery('Пожалуйста, продолжите в личных сообщениях с ботом.');
      return;
    }

    await ctx.answerCbQuery();

    const state = ensureExecutorState(ctx);
    resetVerificationState(state);

    const role = state.role;
    if (!role) {
      return;
    }
    const roleState = state.verification[role];
    roleState.status = 'idle';

    if (ctx.chat?.id) {
      await setChatCommands(ctx.telegram, ctx.chat.id, CLIENT_COMMANDS, { showMenuButton: true });
    }

    await presentRoleSelection(ctx);
  });

  bot.hears(EXECUTOR_MENU_TEXT_LABELS.documents, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      return;
    }

    ensureExecutorState(ctx);
    await startExecutorVerification(ctx);
  });

  bot.on('photo', async (ctx, next) => {
    const message = ctx.message;

    if (
      message &&
      typeof message === 'object' &&
      'media_group_id' in message &&
      typeof (message as { media_group_id?: unknown }).media_group_id === 'string'
    ) {
      return;
    }

    const handled = await handleIncomingPhoto(ctx);
    if (!handled) {
      await next();
    }
  });

  bot.on('media_group' as any, async (ctx, next) => {
    const message = ctx.message;
    if (!message || typeof message !== 'object' || !('media_group_id' in message)) {
      await next();
      return;
    }

    const photoMessage = message as Message.PhotoMessage;
    const mediaGroupId = photoMessage.media_group_id;
    if (typeof mediaGroupId !== 'string') {
      await next();
      return;
    }

    const botCtx = ctx as BotContext;
    const mediaGroupKey = buildMediaGroupKey(botCtx, mediaGroupId);
    if (!mediaGroupKey) {
      await next();
      return;
    }

    const albumMembers = collectMediaGroupPhotos(botCtx.update, mediaGroupId);
    const pending = ensurePendingMediaGroup(mediaGroupKey, photoMessage.message_id);

    registerPendingMediaGroupMessage(pending, photoMessage);
    for (const media of albumMembers) {
      registerPendingMediaGroupMessage(pending, media);
    }

    if (albumMembers.length > 0) {
      resolvePendingMediaGroup(mediaGroupKey, pending);
    } else {
      schedulePendingMediaGroupFlush(mediaGroupKey, pending);
    }

    const { ownerMessageId, messages } = await pending.promise;

    if (photoMessage.message_id !== ownerMessageId) {
      return;
    }

    let handledAny = false;
    for (const media of messages) {
      const handled = await handleIncomingPhoto(botCtx, media);
      handledAny = handledAny || handled;
    }

    if (!handledAny) {
      await next();
    }
  });

  bot.on('text', async (ctx, next) => {
    await handleTextDuringCollection(ctx, next);
  });
};
