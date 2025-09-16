import type { Telegraf } from 'telegraf';

import { getChannelBinding } from '../../channels/bindings';
import { logger } from '../../../config';
import {
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type BotContext,
  type ExecutorFlowState,
  type ExecutorRole,
} from '../../types';
import {
  EXECUTOR_MENU_ACTION,
  EXECUTOR_VERIFICATION_ACTION,
  ensureExecutorState,
  resetVerificationState,
  showExecutorMenu,
} from './menu';
import { getExecutorRoleCopy } from './roleCopy';
import { ui } from '../../ui';

const ROLE_PROMPTS: Record<ExecutorRole, string[]> = {
  courier: [
    `Для доступа к заказам курьера отправьте ${EXECUTOR_VERIFICATION_PHOTO_COUNT} фотографии документов:`,
    '1. Фото удостоверения личности (лицевая сторона).',
    '2. Селфи с удостоверением в руках.',
  ],
  driver: [
    `Для доступа к заказам водителя отправьте ${EXECUTOR_VERIFICATION_PHOTO_COUNT} фотографии документов:`,
    '1. Фото водительского удостоверения (лицевая сторона).',
    '2. Селфи с водительским удостоверением в руках.',
  ],
};

const buildVerificationPrompt = (role: ExecutorRole): string => {
  const lines = ROLE_PROMPTS[role] ?? ROLE_PROMPTS.courier;
  return [...lines, '', 'Отправляйте фотографии по одному сообщению в этот чат.'].join('\n');
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

const buildModerationSummary = (ctx: BotContext, state: ExecutorFlowState): string => {
  const user = ctx.session.user;
  const copy = getExecutorRoleCopy(state.role);
  const verification = state.verification[state.role];
  const lines = [
    `🆕 Новая заявка на верификацию ${copy.genitive}.`,
    `Роль: ${copy.noun} (${state.role})`,
    `Telegram ID: ${ctx.from?.id ?? 'неизвестно'}`,
  ];

  if (user?.username) {
    lines.push(`Username: @${user.username}`);
  }

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  if (fullName) {
    lines.push(`Имя: ${fullName}`);
  }

  if (ctx.session.phoneNumber) {
    lines.push(`Телефон: ${ctx.session.phoneNumber}`);
  }

  lines.push(
    `Фотографии: ${verification.uploadedPhotos.length}/${verification.requiredPhotos}.`,
  );

  return lines.join('\n');
};

const submitForModeration = async (
  ctx: BotContext,
  state: ExecutorFlowState,
): Promise<boolean> => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return false;
  }

  const role = state.role;
  const verification = state.verification[role];

  const verifyChannel = await getChannelBinding('verify');
  if (!verifyChannel) {
    await ui.step(ctx, {
      id: VERIFICATION_CHANNEL_MISSING_STEP_ID,
      text: 'Канал верификации пока не настроен. Попробуйте позже.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return false;
  }

  try {
    const summary = buildModerationSummary(ctx, state);
    const summaryMessage = await ctx.telegram.sendMessage(verifyChannel.chatId, summary);
    verification.moderationThreadMessageId = summaryMessage.message_id;

    for (const photo of verification.uploadedPhotos) {
      try {
        await ctx.telegram.copyMessage(verifyChannel.chatId, chatId, photo.messageId);
      } catch (error) {
        logger.warn(
          {
            err: error,
            chatId: verifyChannel.chatId,
            userChatId: chatId,
            messageId: photo.messageId,
          },
          'Failed to copy verification photo to verification channel',
        );
      }
    }
  } catch (error) {
    logger.error(
      { err: error, chatId: verifyChannel.chatId, role },
      'Failed to submit executor verification to verification channel',
    );
    await ui.step(ctx, {
      id: VERIFICATION_SUBMISSION_FAILED_STEP_ID,
      text: 'Не удалось отправить документы на проверку. Попробуйте позже.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return false;
  }

  verification.status = 'submitted';
  verification.submittedAt = Date.now();

  await ui.step(ctx, {
    id: VERIFICATION_SUBMITTED_STEP_ID,
    text: 'Спасибо! Мы получили ваши документы и передали их модераторам. Ожидайте решения.',
    cleanup: true,
    homeAction: EXECUTOR_MENU_ACTION,
  });

  return true;
};

export const startExecutorVerification = async (
  ctx: BotContext,
): Promise<void> => {
  ensureExecutorState(ctx);
  const state = ctx.session.executor;
  const role = state.role;
  const verification = state.verification[role];

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
    cleanup: true,
    homeAction: EXECUTOR_MENU_ACTION,
  });

  await showExecutorMenu(ctx, { skipAccessCheck: true });
};

const handleIncomingPhoto = async (ctx: BotContext): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    return;
  }

  const state = ensureExecutorState(ctx);
  const role = state.role;
  const verification = state.verification[role];
  const copy = getExecutorRoleCopy(role);

  if (verification.status === 'submitted') {
    await ui.step(ctx, {
      id: VERIFICATION_ALREADY_ON_REVIEW_STEP_ID,
      text: 'Документы уже на проверке. Мы свяжемся с вами после решения модераторов.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return;
  }

  if (verification.status !== 'collecting') {
    await ui.step(ctx, {
      id: VERIFICATION_START_REMINDER_STEP_ID,
      text: `Начните проверку через меню ${copy.genitive}, чтобы отправить документы.`,
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return;
  }

  const message = ctx.message;
  if (!message || !('photo' in message) || !Array.isArray(message.photo) || message.photo.length === 0) {
    return;
  }

  const photoSizes = message.photo;
  const bestPhoto = photoSizes[photoSizes.length - 1];

  verification.uploadedPhotos.push({
    fileId: bestPhoto.file_id,
    messageId: message.message_id,
  });

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
    return;
  }

  await showExecutorMenu(ctx, { skipAccessCheck: true });
};

const handleTextDuringCollection = async (ctx: BotContext, next: () => Promise<void>): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    await next();
    return;
  }

  const state = ensureExecutorState(ctx);
  const verification = state.verification[state.role];
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

  await ui.step(ctx, {
    id: VERIFICATION_PHOTO_REMINDER_STEP_ID,
    text: 'Отправьте, пожалуйста, фотографию документа.',
    cleanup: true,
  });
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

  bot.on('photo', async (ctx) => {
    await handleIncomingPhoto(ctx);
  });

  bot.on('text', async (ctx, next) => {
    await handleTextDuringCollection(ctx, next);
  });
};
