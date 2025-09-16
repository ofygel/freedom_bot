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
  EXECUTOR_VERIFICATION_ACTION,
  ensureExecutorState,
  resetVerificationState,
  showExecutorMenu,
} from './menu';
import { getExecutorRoleCopy } from './roleCopy';

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
    const message = await ctx.reply('Канал верификации пока не настроен. Попробуйте позже.');
    ctx.session.ephemeralMessages.push(message.message_id);
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
    const message = await ctx.reply('Не удалось отправить документы на проверку. Попробуйте позже.');
    ctx.session.ephemeralMessages.push(message.message_id);
    return false;
  }

  verification.status = 'submitted';
  verification.submittedAt = Date.now();

  await ctx.reply(
    'Спасибо! Мы получили ваши документы и передали их модераторам. Ожидайте решения.',
  );

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
    const message = await ctx.reply('Мы уже отправили ваши документы на проверку. Ожидайте решения.');
    ctx.session.ephemeralMessages.push(message.message_id);
    return;
  }

  resetVerificationState(state);
  state.verification[role].status = 'collecting';

  const promptText = buildVerificationPrompt(role);
  const prompt = await ctx.reply(promptText);
  ctx.session.ephemeralMessages.push(prompt.message_id);

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
    const message = await ctx.reply('Документы уже на проверке. Мы свяжемся с вами после решения модераторов.');
    ctx.session.ephemeralMessages.push(message.message_id);
    return;
  }

  if (verification.status !== 'collecting') {
    const message = await ctx.reply(
      `Начните проверку через меню ${copy.genitive}, чтобы отправить документы.`,
    );
    ctx.session.ephemeralMessages.push(message.message_id);
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
  const info = await ctx.reply(`Фото ${uploaded}/${required} получено.`);
  ctx.session.ephemeralMessages.push(info.message_id);

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

  const reminder = await ctx.reply('Отправьте, пожалуйста, фотографию документа.');
  ctx.session.ephemeralMessages.push(reminder.message_id);
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
